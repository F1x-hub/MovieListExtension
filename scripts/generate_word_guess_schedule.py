#!/usr/bin/env python3
"""Generate a dated compact WordGuess schedule for offline bundling.

The extension receives only vocabulary words and uint16 rank tables. Navec is
used by this build-time tool and is never bundled into the extension.

Example:
    py -3 scripts/generate_word_guess_schedule.py \
        --source nouns.csv --source verbs.csv --source adjectives.csv \
        --embeddings navec_hudlit_v1_12B_500K_300d_100q.tar \
        --answers scripts/word_guess_answers_90.txt \
        --start-date 2026-08-21 \
        --output-dir src/shared/data/games/word-guess \
        --manifest src/shared/data/games/word-guess/manifest.json
"""

from __future__ import annotations

import argparse
import base64
import json
import re
import struct
from datetime import date, timedelta
from pathlib import Path
from typing import Iterable

import numpy as np
from navec import Navec

from generate_word_guess_puzzle import WORD_RE, normalize_word, read_vocabulary


def read_answers(path: Path) -> list[str]:
    answers = [normalize_word(line) for line in path.read_text(encoding="utf-8").splitlines()]
    answers = [answer for answer in answers if answer and not answer.startswith("#")]
    if not answers or any(len(answer) != 5 or not WORD_RE.fullmatch(answer) for answer in answers):
        raise SystemExit("Every schedule answer must contain exactly five Cyrillic letters")
    if len(set(answers)) != len(answers):
        raise SystemExit("Schedule answers must be unique after normalization")
    return answers


def rank_words_compact(words: Iterable[str], answers: list[str], model: Navec) -> tuple[list[str], list[np.ndarray]]:
    vocabulary = []
    vectors = []
    for word in sorted(set(words).union(answers)):
        vector = model.get(word)
        if vector is None:
            continue
        norm = np.linalg.norm(vector)
        if norm == 0:
            continue
        vocabulary.append(word)
        vectors.append(vector / norm)

    if len(vocabulary) < len(answers):
        missing = [answer for answer in answers if answer not in vocabulary]
        raise SystemExit(f"Answers absent from embedding vocabulary: {', '.join(missing)}")

    return vocabulary, vectors


def encode_rank_table(similarities: np.ndarray, words: list[str]) -> str:
    order = np.lexsort((np.asarray(words), -similarities))
    ranks = np.empty(len(words), dtype=np.uint16)
    ranks[order] = np.arange(1, len(words) + 1, dtype=np.uint16)
    return base64.b64encode(struct.pack(f"<{len(ranks)}H", *ranks.tolist())).decode("ascii")


def parse_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as error:
        raise SystemExit(f"Invalid --start-date: {value}") from error


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", action="append", type=Path, required=True)
    parser.add_argument("--embeddings", type=Path, required=True)
    parser.add_argument("--answers", type=Path, required=True)
    parser.add_argument("--start-date", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--min-length", type=int, default=3)
    parser.add_argument("--max-length", type=int, default=12)
    parser.add_argument("--embedding-model", default="navec_hudlit_v1_12B_500K_300d_100q")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not args.embeddings.is_file() or not args.answers.is_file():
        raise SystemExit("Embeddings model and answers file must exist")
    missing_sources = [str(path) for path in args.source if not path.is_file()]
    if missing_sources:
        raise SystemExit(f"Vocabulary source does not exist: {', '.join(missing_sources)}")

    answers = read_answers(args.answers)
    start_date = parse_date(args.start_date)
    vocabulary = read_vocabulary(args.source, args.min_length, args.max_length)
    model = Navec.load(str(args.embeddings))
    words, vectors = rank_words_compact(vocabulary, answers, model)
    matrix = np.vstack(vectors)

    data_root = Path("src/shared/data/games/word-guess")
    relative_vocabulary_path = "src/shared/data/games/word-guess/vocabulary.json"
    vocabulary_path = args.output_dir / "vocabulary.json"
    args.output_dir.mkdir(parents=True, exist_ok=True)
    vocabulary_path.write_text(
        json.dumps({"schemaVersion": 1, "words": words}, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )

    entries = []
    for offset, answer in enumerate(answers):
        current_date = start_date + timedelta(days=offset)
        answer_vector = model.get(answer)
        answer_norm = np.linalg.norm(answer_vector)
        similarities = matrix @ (answer_vector / answer_norm)
        puzzle_id = f"puzzle-{current_date.isoformat()}"
        puzzle = {
            "schemaVersion": 2,
            "puzzleId": puzzle_id,
            "embeddingModel": args.embedding_model,
            "answer": answer,
            "wordLength": 5,
            "wordCount": len(words),
            "rankEncoding": "uint16-le-base64",
            "rankTable": encode_rank_table(similarities, words),
        }
        puzzle_path = args.output_dir / "puzzles" / f"{puzzle_id}.json"
        puzzle_path.parent.mkdir(parents=True, exist_ok=True)
        puzzle_path.write_text(json.dumps(puzzle, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
        entries.append({
            "id": puzzle_id,
            "date": current_date.isoformat(),
            "path": f"{data_root.as_posix()}/puzzles/{puzzle_id}.json",
        })

    end_date = start_date + timedelta(days=len(answers) - 1)
    manifest = {
        "schemaVersion": 2,
        "rotation": {
            "timezone": "UTC",
            "anchorDate": start_date.isoformat(),
            "endDate": end_date.isoformat(),
        },
        "vocabulary": {
            "path": relative_vocabulary_path,
            "encoding": "uint16-le-base64",
        },
        "puzzles": entries,
    }
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Generated {len(entries)} puzzles, {len(words)} vocabulary words, through {end_date.isoformat()}")


if __name__ == "__main__":
    main()
