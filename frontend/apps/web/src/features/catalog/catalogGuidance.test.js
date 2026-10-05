import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ATTRIBUTE_TYPE_GUIDE, CATEGORY_PLAYBOOKS, LISTING_FIELD_GUIDE,
  MASTER_FIELD_GUIDE, findPlaybook,
} from './catalogGuidance.js';

const FIELD_TYPES = new Set(['string', 'text', 'number', 'boolean', 'select', 'multi_select', 'date', 'json']);
const SCOPES = new Set(['master', 'variant', 'both']);
const COMPLIANCE_TYPES = new Set(['certificate', 'license', 'regulatory_id', 'standard', 'restriction', 'safety', 'environmental']);

describe('catalog guidance book', () => {
  test('category playbooks have unique stable identities and complete examples', () => {
    assert.ok(CATEGORY_PLAYBOOKS.length >= 20);
    assert.equal(new Set(CATEGORY_PLAYBOOKS.map((item) => item.id)).size, CATEGORY_PLAYBOOKS.length);
    for (const item of CATEGORY_PLAYBOOKS) {
      assert.match(item.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      assert.ok(item.name && item.group && item.summary && item.unitPolicy);
      assert.ok(item.attributes.length >= 5, `${item.name} needs a useful schema`);
      assert.ok(item.variantAxes.length >= 1, `${item.name} needs variant guidance`);
      assert.ok(item.example?.title && item.example?.sku && item.example?.listing);
    }
  });

  test('recommended schemas use backend-supported typed EAV contracts', () => {
    for (const item of CATEGORY_PLAYBOOKS) {
      const keys = new Set();
      for (const field of item.attributes) {
        assert.match(field.key, /^[a-z0-9_]+$/, `${item.name}: ${field.key}`);
        assert.ok(!keys.has(field.key), `${item.name}: duplicate ${field.key}`);
        keys.add(field.key);
        assert.ok(FIELD_TYPES.has(field.type), `${item.name}: unsupported ${field.type}`);
        assert.ok(SCOPES.has(field.appliesTo), `${item.name}: unsupported scope`);
        if (field.min != null && field.max != null) assert.ok(field.min <= field.max);
      }
    }
  });

  test('compliance templates fit the category mutation contract', () => {
    for (const item of CATEGORY_PLAYBOOKS) {
      const codes = new Set();
      for (const requirement of item.compliance) {
        assert.ok(requirement.code && requirement.label);
        assert.ok(!codes.has(requirement.code), `${item.name}: duplicate ${requirement.code}`);
        codes.add(requirement.code);
        assert.ok(COMPLIANCE_TYPES.has(requirement.type));
        assert.ok(Array.isArray(requirement.jurisdictions));
      }
    }
  });

  test('smartphone lookup resolves aliases and carries core compliance', () => {
    const phone = findPlaybook('5g phone');
    assert.equal(phone?.id, 'smartphones');
    for (const code of ['BIS_CRS_MOBILE', 'WPC_ETA_WIRELESS', 'E_WASTE_EPR', 'LEGAL_METROLOGY_PACK']) {
      assert.ok(phone.compliance.some((item) => item.code === code));
    }
    assert.ok(phone.attributes.some((item) => item.key === 'storage_gb' && item.appliesTo === 'variant'));
  });

  test('master, listing and type chapters remain substantive', () => {
    assert.ok(MASTER_FIELD_GUIDE.length >= 10);
    assert.ok(LISTING_FIELD_GUIDE.length >= 20);
    assert.deepEqual(new Set(ATTRIBUTE_TYPE_GUIDE.map(([type]) => type)), FIELD_TYPES);
  });
});
