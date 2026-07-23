# indonesia

Source for [Indonesia Bisa](https://indonesia.uwuapps.org), a small, free directory of Indonesia-focused tools and data, published by [UwU Apps](https://uwuapps.org).

The site itself, including what it does and how it's built, is documented in [`main-site/README.md`](main-site/README.md).

## Repository layout

```text
main-site/   the site (deployed to Vercel as the project root)
LICENSE
CODE_OF_CONDUCT.md
```

## Contributing

Issues and pull requests are welcome - whether that's a bug fix, a new page built on another free, keyless, Indonesia-relevant public API, or an improvement to an existing one. Please read [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) before participating.

When adding a new page, follow the existing pattern in `main-site`: a static HTML/CSS/JS page under its own directory, a matching serverless function under `main-site/api` that validates input, caches responses and handles upstream failures gracefully, and an entry in the homepage directory (`main-site/js/index.js`).

## License

MIT - see [`LICENSE`](LICENSE).
