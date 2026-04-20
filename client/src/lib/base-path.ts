const rawBasePath = import.meta.env.BASE_URL || "/";

export const appBasePath =
  rawBasePath === "/" ? "/" : rawBasePath.replace(/\/+$/, "");

export function withBasePath(path: string) {
  const normalizedPath = path.replace(/^\/+/, "");

  if (!normalizedPath) {
    return appBasePath === "/" ? "/" : `${appBasePath}/`;
  }

  return appBasePath === "/" ? `/${normalizedPath}` : `${appBasePath}/${normalizedPath}`;
}

