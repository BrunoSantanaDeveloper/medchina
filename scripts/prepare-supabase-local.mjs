import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const source = path.resolve(root, "packages", "db", "migrations");
const destination = path.resolve(root, "supabase", "migrations");
if (!source.startsWith(root) || !destination.startsWith(root)) throw new Error("Unsafe migration path");

await mkdir(destination, { recursive: true });
for (const entry of await readdir(destination, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith(".sql")) await rm(path.join(destination, entry.name));
}
for (const entry of await readdir(source, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith(".sql")) {
    await copyFile(path.join(source, entry.name), path.join(destination, entry.name));
  }
}
