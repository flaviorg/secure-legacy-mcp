// createCustomer (spec 5.4): additive write, autonomy band 2 (audited by the API).
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CustomerService } from '../application/customer-service.ts';
import { createCustomerInput, createCustomerOutput } from '../domain/customer.ts';
import { defineTool } from './define-tool.ts';
import type { ToolDeps } from './define-tool.ts';

const CREATE_CUSTOMER_DESCRIPTION =
  'Register a new active customer. Requires the admin role. ' +
  'The email is stored in lowercase and must not belong to another customer (else CONFLICT); ' +
  'the phone may use any common Brazilian format and is stored in E.164. Returns the full customer with its new id.';

export function registerCreateCustomerTool(server: McpServer, deps: { service: CustomerService } & ToolDeps): void {
  defineTool(server, deps, {
    name: 'createCustomer',
    description: CREATE_CUSTOMER_DESCRIPTION,
    inputSchema: createCustomerInput,
    outputSchema: createCustomerOutput,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    handler: (input, ctx) => deps.service.createCustomer(input, ctx),
  });
}
