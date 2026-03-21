
// Helper per estrarre stringhe da query o headers
export const getString = (val: any): string | undefined => {
  if (Array.isArray(val)) return val[0] as string;
  if (typeof val === "string") return val;
  return undefined;
};
