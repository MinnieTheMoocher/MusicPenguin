declare module "sql.js" {
  const initSqlJs: () => Promise<import("./types.js").SqlJsStatic>;
  export default initSqlJs;
}
