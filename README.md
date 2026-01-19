# Applesauce

Applesauce is a collection typescript libraries to make building nostr web clients easier and is used in [noStrudel](https://github.com/hzrd149/nostrudel)

The full documentation can be found on the [documentation](https://hzrd149.github.io/applesauce) site.

## Installation

```bash
# using npm
npm install applesauce-core
# using pnpm
pnpm install applesauce-core
# using yarn
yarn add applesauce-core
```

## Development Setup

Clone the repository:

```bash
git clone https://github.com/hzrd149/applesauce.git
cd applesauce
```

Install dependencies:

```bash
pnpm install
```

Build the project:

```bash
pnpm build
```

## Running tests

This repo uses [vitest](https://vitest.dev/) for all tests

```bash
# Run all tests
pnpm test
# Run coverage tests
pnpm coverage
# Run the tests in dev mode
pnpm vitest
```

## Running documentation

This repo is setup with [typedoc](https://typedoc.org/) for the typescript documentation and [vitepress](https://vitepress.dev/) for the documentation site

```bash
# Build the typedocs
pnpm typedoc
```

The `apps/docs` is the package for the docs site

```bash
cd apps/docs

# Run vitepress dev
pnpm dev

# Build vitepress
pnpm build
```

## React

The `applesauce-react` package contains various hooks and providers for using applesauce in react components, [Docs](https://applesauce.build/react/getting-started.html)

## Contributing

1. Fork the repository
2. Create your feature branch: `git checkout -b feature/my-new-feature`
3. Install dependencies: `pnpm install`
4. Make your changes
5. Run tests: `pnpm test`
6. Build the project: `pnpm build`
7. Format code: `pnpm format`
8. Commit your changes: `git commit -am 'Add some feature'`
9. Push to the branch: `git push origin feature/my-new-feature`
10. Submit a pull request
