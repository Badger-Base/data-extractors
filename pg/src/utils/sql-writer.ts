import fs from "fs/promises";
import path from "path";

const SQL_DIR = path.resolve(import.meta.dirname, "../../data/sql");

export function esc(val: unknown): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "boolean") return val ? "true" : "false";
  if (typeof val === "number") return String(val);
  return `'${String(val).replace(/'/g, "''")}'`;
}

export function escEnum(val: string, type: string): string {
  return `${esc(val)}::${type}`;
}

export class SqlWriter {
  private lines: string[] = [];

  comment(text: string): void {
    this.lines.push(`-- ${text}`);
  }

  raw(sql: string): void {
    this.lines.push(sql);
  }

  blank(): void {
    this.lines.push("");
  }

  insertRow(table: string, columns: string[], values: string[]): void {
    this.lines.push(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${values.join(", ")});`
    );
  }

  insertBatch(table: string, columns: string[], rows: string[][]): void {
    if (rows.length === 0) return;
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const valuesStr = chunk
        .map((vals) => `  (${vals.join(", ")})`)
        .join(",\n");
      this.lines.push(
        `INSERT INTO ${table} (${columns.join(", ")}) VALUES\n${valuesStr};`
      );
      this.blank();
    }
  }

  async writeTo(filename: string): Promise<string> {
    await fs.mkdir(SQL_DIR, { recursive: true });
    const filePath = path.join(SQL_DIR, filename);
    await fs.writeFile(filePath, this.lines.join("\n") + "\n");
    return filePath;
  }
}
