export const COMBO_COMPRESSION_ENGINES = {
  rtkEnabled: "RTK tool output",
  headroomEnabled: "Headroom",
  cavemanEnabled: "Caveman",
  ponytailEnabled: "Ponytail",
  pxpipeEnabled: "Pxpipe",
  toolDedupEnabled: "Duplicate tool outputs",
};

export function normalizeComboCompression(input) {
  const result = {};
  for (const key of Object.keys(COMBO_COMPRESSION_ENGINES)) {
    if (typeof input?.[key] === "boolean") result[key] = input[key];
  }
  if (typeof input?.semanticCacheModel === "string") {
    result.semanticCacheModel = input.semanticCacheModel.trim().slice(0, 200);
  }
  return result;
}
