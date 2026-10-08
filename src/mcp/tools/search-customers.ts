// searchCustomers (spec 5.4): filtered, paginated listing, autonomy band 1.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CustomerService } from '../application/customer-service.ts';
import { searchCustomersInput, searchCustomersOutput } from '../domain/customer.ts';
import { defineTool } from './define-tool.ts';
import type { ToolDeps } from './define-tool.ts';

const SEARCH_CUSTOMERS_DESCRIPTION =
  'Filter customers by name fragment, status, segment and registration date range. ' +
  'Returns summaries and the filtered total, one page at a time (limit 1-50, default 10). ' +
  'Pass nextCursor back as cursor, with the same filters, for the next page; null means no more pages.';

export function registerSearchCustomersTool(server: McpServer, deps: { service: CustomerService } & ToolDeps): void {
  defineTool(server, deps, {
    name: 'searchCustomers',
    description: SEARCH_CUSTOMERS_DESCRIPTION,
    inputSchema: searchCustomersInput,
    outputSchema: searchCustomersOutput,
    annotations: { readOnlyHint: true },
    handler: (input, ctx) => deps.service.searchCustomers(input, ctx),
  });
}
