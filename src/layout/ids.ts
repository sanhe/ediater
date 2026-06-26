let counter = 0;

/** Generate a process-unique id with a readable prefix (panel/leaf/split ids). */
export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}_${counter.toString(36)}${Date.now().toString(36).slice(-4)}`;
}
