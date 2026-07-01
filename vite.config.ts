import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// Inline CSS into JS so the plugin loads as a single dist/index.js file
function inlineCssPlugin(): Plugin {
  return {
    name: "inline-css",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      let cssContent = "";
      const cssFiles: string[] = [];

      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (fileName.endsWith(".css") && chunk.type === "asset") {
          cssContent += (chunk as any).source;
          cssFiles.push(fileName);
        }
      }

      if (cssContent && bundle["index.js"]?.type === "chunk") {
        const jsChunk = bundle["index.js"] as any;
        const escaped = cssContent
          .replace(/\\/g, "\\\\")
          .replace(/`/g, "\\`")
          .replace(/\$/g, "\\$");
        jsChunk.code =
          `(function(){var s=document.createElement("style");s.textContent=\`${escaped}\`;document.head.appendChild(s)})();\n` +
          jsChunk.code;
      }

      // Remove CSS files from bundle
      for (const f of cssFiles) {
        delete bundle[f];
      }
    },
  };
}

export default defineConfig({
  plugins: [react({ jsxRuntime: "classic" }), inlineCssPlugin()],
  resolve: {
    alias: {
      // Redirect "react" and "react-dom" imports to the host shim
      react: resolve(__dirname, "src/react-shim.ts"),
      "react-dom": resolve(__dirname, "src/react-shim.ts"),
    },
  },
  build: {
    lib: {
      entry: "src/index.tsx",
      formats: ["es"],
      fileName: () => "index.js",
    },
    // No external — React is resolved via alias, not left as bare import
    rollupOptions: {},
  },
});
