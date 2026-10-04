# Reflection

The registry/pool design supported TMDB without a second client credential path.
TMDB's lack of a daily remaining counter required a provider-specific UI state
instead of extending the Kinopoisk aggregate. The legacy secret remains a
bounded compatibility bridge with a clear retirement trigger.
