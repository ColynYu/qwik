import fs from 'node:fs';
import { join } from 'node:path';
import { getErrorHtml } from '../../../middleware/request-handler';

export async function postBuild(
  clientOutDir: string,
  basePathname: string,
  userStaticPaths: string[],
  format: string,
  cleanStatic: boolean
) {
  const ingorePathnames = new Set([basePathname + 'build/', basePathname + 'assets/']);

  const staticPaths = new Set(userStaticPaths);
  const notFounds: string[][] = [];

  const loadItem = async (fsDir: string, fsName: string, pathname: string) => {
    if (ingorePathnames.has(pathname)) {
      return;
    }

    const fsPath = join(fsDir, fsName);

    if (fsName === 'index.html' || fsName === 'q-data.json') {
      // static index.html file
      if (!staticPaths.has(pathname) && cleanStatic) {
        await fs.promises.unlink(fsPath);
      }
      return;
    }

    if (fsName === '404.html') {
      // static 404.html file
      const notFoundHtml = await fs.promises.readFile(fsPath, 'utf-8');
      notFounds.push([pathname, notFoundHtml]);
      return;
    }

    const stat = await fs.promises.stat(fsPath);
    if (stat.isDirectory()) {
      await loadDir(fsPath, pathname + fsName + '/');
    } else if (stat.isFile()) {
      staticPaths.add(pathname + fsName);
    }
  };

  const loadDir = async (fsDir: string, pathname: string) => {
    const itemNames = await fs.promises.readdir(fsDir);
    await Promise.all(itemNames.map((i) => loadItem(fsDir, i, pathname)));
  };

  await loadDir(clientOutDir, basePathname);

  const notFoundPathsCode = createNotFoundPathsModule(basePathname, notFounds, format);
  const staticPathsCode = createStaticPathsModule(basePathname, staticPaths, format);

  return {
    notFoundPathsCode,
    staticPathsCode,
  };
}

function createNotFoundPathsModule(basePathname: string, notFounds: string[][], format: string) {
  notFounds.sort((a, b) => {
    if (a[0].length > b[0].length) return -1;
    if (a[0].length < b[0].length) return 1;
    if (a[0] < b[0]) return -1;
    if (a[0] > b[0]) return 1;
    return 0;
  });

  if (!notFounds.some((r) => r[0] === basePathname)) {
    const html = getErrorHtml(404, 'Resource Not Found');
    notFounds.push([basePathname, html]);
  }

  const c: string[] = [];

  c.push(`const notFounds = ${JSON.stringify(notFounds, null, 2)};`);

  c.push(`function getNotFound(p) {`);
  c.push(`  for (const r of notFounds) {`);
  c.push(`    if (p.startsWith(r[0])) {`);
  c.push(`      return r[1];`);
  c.push(`    }`);
  c.push(`  }`);
  c.push(`  return "Resource Not Found";`);
  c.push(`}`);

  if (format === 'cjs') {
    c.push('exports.getNotFound = getNotFound;');
  } else {
    c.push('export { getNotFound };');
  }

  return c.join('\n');
}

function createStaticPathsModule(basePathname: string, staticPaths: Set<string>, format: string) {
  const assetsPath = basePathname + 'assets/';
  const baseBuildPath = basePathname + 'build/';

  const c: string[] = [];

  c.push(
    `const staticPaths = new Set(${JSON.stringify(
      Array.from(new Set<string>(staticPaths)).sort()
    )});`
  );

  c.push(`function isStaticPath(url) {`);
  c.push(`  if (url.searchParams.get('qwikcity.static') === "false") {`);
  c.push(`    return false;`);
  c.push(`  }`);
  c.push(`  const p = url.pathname;`);
  c.push(`  if (p.startsWith(${JSON.stringify(baseBuildPath)})) {`);
  c.push(`    return true;`);
  c.push(`  }`);
  c.push(`  if (p.startsWith(${JSON.stringify(assetsPath)})) {`);
  c.push(`    return true;`);
  c.push(`  }`);
  c.push(`  if (staticPaths.has(p)) {`);
  c.push(`    return true;`);
  c.push(`  }`);
  c.push(`  return false;`);
  c.push(`}`);

  if (format === 'cjs') {
    c.push('exports.isStaticPath = isStaticPath;');
  } else {
    c.push('export { isStaticPath };');
  }

  return c.join('\n');
}
