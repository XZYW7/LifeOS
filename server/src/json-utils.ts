/** 移植自 TraceBrain packages/core/src/agent/json-utils.ts（原样保留） */
export function extractAndRepairJSON<T>(text: string): T {
  // Try direct parse first
  try {
    return JSON.parse(text) as T;
  } catch {}

  // Extract JSON from markdown code block
  const codeBlockMatch = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/m);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1]) as T;
    } catch {}
  }

  // Extract the first JSON object/array
  const objectMatch = text.match(/({[\s\S]*})/);
  if (objectMatch) {
    try {
      return JSON.parse(objectMatch[1]) as T;
    } catch {}
  }

  const arrayMatch = text.match(/(\[[\s\S]*\])/);
  if (arrayMatch) {
    try {
      return JSON.parse(arrayMatch[1]) as T;
    } catch {}
  }

  throw new Error('No valid JSON found');
}
