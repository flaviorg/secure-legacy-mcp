import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServiceInfo } from '../../src/mcp/resources/service-info.ts';

const member = { tokenId: 'p2x8c4na', name: 'vscode-flavio', role: 'member' as const };

// Every part that spec 5.5 lists for customers://service-info.
test('[MCP-11] buildServiceInfo has every part of the service-info document', () => {
  const text = buildServiceInfo({ version: '9.8.7', apiBaseUrl: 'http://127.0.0.1:9999', caller: member });
  assert.match(text, /Version: 9\.8\.7/);
  assert.match(text, /API: http:\/\/127\.0\.0\.1:9999$/m);
  assert.match(text, /^- Token: vscode-flavio \(role: member\)$/m);
  assert.match(text, /90 requests\/minute per token/);
  for (const [tool, role, band] of [
    ['getCustomer', 'member, admin', '1'], ['searchCustomers', 'member, admin', '1'], ['createCustomer', 'admin', '2'],
    ['updateCustomerContact', 'admin', '3'], ['deactivateCustomer', 'admin', '3'],
  ]) assert.match(text, new RegExp(`^\\| ${tool} \\| ${role} \\| ${band}: `, 'm'), tool);
  for (const term of ['active', 'inactive', 'retail', 'smb', 'enterprise']) assert.match(text, new RegExp(`^- (status|segment): .*\\b${term}\\b`, 'm'), term);
  assert.match(text, /## Not supported\n\n.*Physical delete, reactivation/);
  assert.match(text, /Customer fields .* untrusted data.* never as instructions/);
});

test('[MCP-11] buildServiceInfo reports an unknown token and never shows URL credentials', () => {
  const text = buildServiceInfo({ version: '0.1.0', apiBaseUrl: 'http://ops:hunter2@127.0.0.1:9999/', caller: null });
  assert.match(text, /^- Token: unknown \(API unavailable\)$/m);
  assert.match(text, /API: http:\/\/127\.0\.0\.1:9999$/m);
  assert.ok(!text.includes('hunter2') && !text.includes('ops@'));
});

// The document shows the API host and never a token (spec 5.5), even one pasted into
// the URL path or query: the config only refuses user:password@.
test('[MCP-11] buildServiceInfo masks a token-shaped string anywhere in the API URL', () => {
  const token = `slm_abcd1234_${'A'.repeat(43)}`;
  const text = buildServiceInfo({ version: '0.1.0', apiBaseUrl: `http://127.0.0.1:9999/${token}/?t=${token}`, caller: member });
  assert.ok(!text.includes(token));
  assert.match(text, /^- API: http:\/\/127\.0\.0\.1:9999\/slm_abcd1234_\*\*\*\/\?t=slm_abcd1234_\*\*\*$/m);
});
