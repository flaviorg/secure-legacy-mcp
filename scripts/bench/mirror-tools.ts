// REST mirror generator (spec 9.1, BEN-03): turns docs/legacy-api/openapi.json into
// one tool definition per operation, mechanically, the way REST-to-MCP converters do.
// Pure function: no I/O, no hand-written tweaks, so the mirror cannot be made worse
// on purpose.

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
};

type OpenApiParameter = {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  schema?: Record<string, unknown>;
};

type OpenApiOperation = {
  operationId: string;
  summary?: string;
  description?: string;
  parameters?: OpenApiParameter[];
  requestBody?: {
    content?: Record<string, { schema?: { properties?: Record<string, unknown>; required?: string[] } }>;
  };
};

// The minimum of an OpenAPI 3.x document that the generator reads. Besides operations, a
// path item may carry summary, description, parameters or servers.
export type OpenApiDocument = { paths: Record<string, Record<string, unknown>> };

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace']);
const INPUT_LOCATIONS = new Set(['path', 'query']);

function toDefinition(op: OpenApiOperation): ToolDefinition {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const p of op.parameters ?? []) {
    if (!INPUT_LOCATIONS.has(p.in)) continue;
    properties[p.name] = p.description === undefined ? { ...p.schema } : { ...p.schema, description: p.description };
    if (p.required === true) required.push(p.name);
  }
  const body = op.requestBody?.content?.['application/json']?.schema;
  Object.assign(properties, body?.properties ?? {});
  required.push(...(body?.required ?? []));
  const description = [op.summary, op.description].filter((s): s is string => s !== undefined && s !== '').join('\n');
  const inputSchema: ToolDefinition['inputSchema'] = { type: 'object', properties };
  if (required.length > 0) inputSchema.required = required;
  return { name: op.operationId, description, inputSchema };
}

// The operations of the document in order: only the HTTP-method keys of each path item.
export function listOperations(spec: OpenApiDocument): { path: string; method: string; op: OpenApiOperation }[] {
  return Object.entries(spec.paths).flatMap(([path, item]) =>
    Object.entries(item).filter(([method]) => HTTP_METHODS.has(method)).map(([method, op]) => ({ path, method, op: op as OpenApiOperation })));
}

// One definition per operation, in document order.
export function openApiToMirrorTools(spec: OpenApiDocument): ToolDefinition[] {
  return listOperations(spec).map(({ op }) => toDefinition(op));
}
