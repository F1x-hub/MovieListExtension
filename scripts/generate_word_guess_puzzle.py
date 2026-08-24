#!/usr/bin/env python3
"""Generate one compact offline WordGuess puzzle from Russian vocabulary and Navec.

This script is a content-preparation tool. It is not imported by the extension
and the embedding model is never bundled into the extension.

Example:
    py -3 scripts/generate_word_guess_puzzle.py \
        --source nouns.csv --source verbs.csv --source adjectives.csv \
        --embeddings navec_hudlit_v1_12B_500K_300d_100q.tar \
        --answer океан --puzzle-id puzzle-2026-08-21 --output \
        --vocabulary-output src/shared/data/games/word-guess/vocabulary.json \
        --output src/shared/data/games/word-guess/puzzles/puzzle-2026-08-21.json
"""

from __future__ import annotations

import argparse
import base64
import csv
import json
import re
import struct
import sys
from pathlib import Path
from typing import Iterable


WORD_RE = re.compile(r"^[а-я]+$")


def normalize_word(value: str) -> str:
    """Apply the same normalization used by the extension controller."""

    return value.strip().lower().replace("ё", "е")


def read_vocabulary(paths: Iterable[Path], min_length: int, max_length: int) -> set[str]:
    """Read the first column from OpenRussian-style CSV/TSV files."""

    words: set[str] = set()
    for path in paths:
        if path.suffix.lower() == ".json":
            payload = json.loads(path.read_text(encoding="utf-8"))
            candidates = payload.get("words", [])
            if not candidates and isinstance(payload.get("ranks"), dict):
                candidates = payload["ranks"].keys()
            for value in candidates:
                word = normalize_word(str(value))
                if min_length <= len(word) <= max_length and WORD_RE.fullmatch(word):
                    words.add(word)
            continue

        with path.open("r", encoding="utf-8-sig", newline="") as source:
            sample = source.read(4096)
            source.seek(0)
            dialect = csv.Sniffer().sniff(sample, delimiters="\t,;")
            reader = csv.reader(source, dialect)

            for row in reader:
                if not row:
                    continue
                word = normalize_word(row[0])
                if min_length <= len(word) <= max_length and WORD_RE.fullmatch(word):
                    words.add(word)
    return words


def rank_words(words: Iterable[str], answer: str, embeddings_path: Path) -> tuple[dict[str, int], int]:
    """Rank words by cosine similarity to the answer using Navec."""

    try:
        import numpy as np
        from navec import Navec
    except ImportError as error:
        raise SystemExit(
            "Missing generator dependencies. Install them with: "
            "py -3 -m pip install navec numpy"
        ) from error

    model = Navec.load(str(embeddings_path))
    normalized_answer = normalize_word(answer)
    answer_vector = model.get(normalized_answer)
    if answer_vector is None:
        raise SystemExit(f"Answer {answer!r} is absent from the embedding vocabulary")

    answer_norm = np.linalg.norm(answer_vector)
    if answer_norm == 0:
        raise SystemExit(f"Answer {answer!r} has a zero embedding vector")

    scored: list[tuple[float, str]] = []
    missing_vectors = 0
    for word in sorted(set(words)):
        vector = model.get(word)
        if vector is None:
            missing_vectors += 1
            continue
        vector_norm = np.linalg.norm(vector)
        if vector_norm == 0:
            missing_vectors += 1
            continue
        similarity = float(np.dot(vector, answer_vector) / (vector_norm * answer_norm))
        scored.append((similarity, word))

    if normalized_answer not in {word for _, word in scored}:
        raise SystemExit(f"Answer {answer!r} has no usable vector after vocabulary filtering")

    # Highest cosine similarity is rank 1. Word order makes ties deterministic.
    scored.sort(key=lambda item: (-item[0], item[1]))
    ranks = {word: index + 1 for index, (_, word) in enumerate(scored)}
    return ranks, missing_vectors


def encode_rank_table(ranks: dict[str, int], vocabulary: list[str]) -> str:
    values = [ranks[word] for word in vocabulary]
    if any(value > 65535 for value in values):
        raise SystemExit("Rank table does not fit in uint16")
    packed = struct.pack(f"<{len(values)}H", *values)
    return base64.b64encode(packed).decode("ascii")


def write_vocabulary(path: Path, vocabulary: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as target:
        json.dump({"schemaVersion": 1, "words": vocabulary}, target,
                  ensure_ascii=False, separators=(",", ":"))
        target.write("\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", action="append", type=Path, required=True,
                        help="OpenRussian CSV/TSV source; may be repeated")
    parser.add_argument("--embeddings", type=Path, required=True,
                        help="Path to a Navec .tar model")
    parser.add_argument("--answer", required=True,
                        help="Five-letter Russian answer word")
    parser.add_argument("--puzzle-id", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--vocabulary-output", type=Path, required=True)
    parser.add_argument("--min-length", type=int, default=3)
    parser.add_argument("--max-length", type=int, default=12)
    parser.add_argument("--embedding-model", default="navec_hudlit_v1_12B_500K_300d_100q")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    answer = normalize_word(args.answer)
    if len(answer) != 5 or not WORD_RE.fullmatch(answer):
        raise SystemExit("--answer must be exactly five Cyrillic letters")
    if args.min_length < 1 or args.max_length < args.min_length:
        raise SystemExit("Invalid --min-length/--max-length range")
    missing_sources = [str(path) for path in args.source if not path.is_file()]
    if missing_sources:
        raise SystemExit(f"Vocabulary source does not exist: {', '.join(missing_sources)}")
    if not args.embeddings.is_file():
        raise SystemExit(f"Embedding model does not exist: {args.embeddings}")

    vocabulary = read_vocabulary(args.source, args.min_length, args.max_length)
    vocabulary.add(answer)
    ranks, missing_vectors = rank_words(vocabulary, answer, args.embeddings)
    if ranks.get(answer) != 1:
        raise SystemExit(f"Generated ranks are invalid: answer rank is {ranks.get(answer)!r}")

    compact_vocabulary = sorted(ranks)
    write_vocabulary(args.vocabulary_output, compact_vocabulary)
    puzzle = {
        "schemaVersion": 2,
        "puzzleId": args.puzzle_id,
        "embeddingModel": args.embedding_model,
        "answer": answer,
        "wordLength": 5,
        "wordCount": len(compact_vocabulary),
        "rankEncoding": "uint16-le-base64",
        "rankTable": encode_rank_table(ranks, compact_vocabulary),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8", newline="\n") as target:
        json.dump(puzzle, target, ensure_ascii=False, separators=(",", ":"))
        target.write("\n")

    print(
        f"Generated {args.output}: {len(ranks)} ranked words, "
        f"answer={ascii(answer)}, omitted={missing_vectors} words without embeddings"
    )


if __name__ == "__main__":
    try:
        main()
    except csv.Error as error:
        raise SystemExit(f"Could not parse vocabulary source: {error}") from error
