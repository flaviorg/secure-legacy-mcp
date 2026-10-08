// updateCustomerContact (spec 5.4): overwrites contact data, autonomy band 3 (the
// MCP client should ask for confirmation).
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CustomerService } from '../application/customer-service.ts';
import { updateContactInput, updateContactOutput } from '../domain/customer.ts';
import { defineTool } from './define-tool.ts';
import type { ToolDeps } from './define-tool.ts';

const UPDATE_CUSTOMER_CONTACT_DESCRIPTION =
  'Change the email and/or phone of a customer by id (resolve the id with getCustomer first). Requires the admin role. ' +
  'Idempotent: values equal to the current ones change nothing and return changed=[]. ' +
  'An email used by another customer gives CONFLICT.';

export function registerUpdateCustomerContactTool(server: McpServer, deps: { service: CustomerService } & ToolDeps): void {
  defineTool(server, deps, {
    name: 'updateCustomerContact',
    description: UPDATE_CUSTOMER_CONTACT_DESCRIPTION,
    inputSchema: updateContactInput,
    outputSchema: updateContactOutput,
    annotations: { destructiveHint: true, idempotentHint: true },
    handler: (input, ctx) => deps.service.updateContact(input, ctx),
  });
}
