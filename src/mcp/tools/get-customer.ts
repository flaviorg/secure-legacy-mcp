// getCustomer (spec 5.4): read-only resolution of one customer, autonomy band 1.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CustomerService } from '../application/customer-service.ts';
import { getCustomerInput, getCustomerOutput } from '../domain/customer.ts';
import { defineTool } from './define-tool.ts';
import type { ToolDeps } from './define-tool.ts';

const GET_CUSTOMER_DESCRIPTION =
  'Resolve one customer by id, email, phone or name (accents and case ignored). ' +
  'Returns match=found with the customer, ambiguous with up to 5 candidates to ask the user about, or none. ' +
  'Never guesses between homonyms. Use it before any write to get the customer id.';

export function registerGetCustomerTool(server: McpServer, deps: { service: CustomerService } & ToolDeps): void {
  defineTool(server, deps, {
    name: 'getCustomer',
    description: GET_CUSTOMER_DESCRIPTION,
    inputSchema: getCustomerInput,
    outputSchema: getCustomerOutput,
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: (input, ctx) => deps.service.getCustomer(input, ctx),
  });
}
