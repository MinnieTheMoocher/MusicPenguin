/* esbuild loads the tabler-icon files as raw text (`--loader:.svg=text`
   in package.json's build:renderer/watch scripts). This ambient
   declaration lets `tsc --noEmit` type-check the default-string import. */
declare module "*.svg" {
  const content: string;
  export default content;
}

/* The bundled icon license is loaded the same way (`--loader:.md=text`) */
declare module "*.md" {
  const content: string;
  export default content;
}
