---
name: build-plugin
description: Build the dialog-index-plugin for production (vite build)
user_invocable: true
disable_model_invocation: true
---

# Build Plugin

Build the dialog-index-plugin into `dist/index.js`.

## Usage

```
/build-plugin
```

## Steps

1. Run `npm run build` (which runs `vite build`)
2. Confirm the output: `dist/index.js` was generated
3. Report the output file size
