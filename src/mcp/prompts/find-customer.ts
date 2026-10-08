// find-customer (spec 5.5): resolve without ever guessing between homonyms.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const findCustomerText = (query: string) =>
  `Find the customer matching "${query}". Call getCustomer with the most specific criteria you can extract (id, email, phone or name). ` +
  'If the result is "ambiguous", list the candidates (id, name, email) and ask which one I mean. If it is "none", say so. ' +
  'Never guess or pick a candidate yourself.';

export function registerFindCustomerPrompt(server: McpServer): void {
  server.registerPrompt(
    'find-customer',
    {
      title: 'Find a customer',
      description: 'Resolve one customer with getCustomer and ask when the result is ambiguous',
      argsSchema: { query: z.string().describe('Who to look for: id, email, phone or name') },
    },
    ({ query }) => ({ messages: [{ role: 'user', content: { type: 'text', text: findCustomerText(query) } }] }),
  );
}
