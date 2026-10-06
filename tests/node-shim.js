// Minimální náhrada node:test a node:assert/strict pro běh testů v prohlížeči (tests/run.html).
const queue = [];

export function test(name, fn) {
  queue.push({ name, fn });
}

export async function runAll(report) {
  let passed = 0;
  let failed = 0;
  for (const { name, fn } of queue) {
    try {
      await fn();
      passed++;
      report({ name, ok: true });
    } catch (err) {
      failed++;
      report({ name, ok: false, err });
    }
  }
  return { passed, failed };
}

class AssertionError extends Error {}

function fail(message, fallback) {
  throw new AssertionError(message ?? fallback);
}

function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]));
}

const assert = {
  equal(actual, expected, msg) {
    if (!Object.is(actual, expected)) fail(msg, `${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  },
  deepEqual(actual, expected, msg) {
    if (!deepEqual(actual, expected)) fail(msg, `${JSON.stringify(actual)} neodpovídá ${JSON.stringify(expected)}`);
  },
  ok(value, msg) {
    if (!value) fail(msg, `Očekávána pravdivá hodnota, dostáno ${JSON.stringify(value)}`);
  },
  match(actual, regex, msg) {
    if (typeof actual !== 'string' || !regex.test(actual)) fail(msg, `${JSON.stringify(actual)} neodpovídá ${regex}`);
  },
  throws(fn, expected, msg) {
    try {
      fn();
    } catch (err) {
      if (typeof expected === 'function' && !(err instanceof expected)) fail(msg, `Neočekávaná chyba ${err}`);
      return;
    }
    fail(msg, 'Očekávána výjimka');
  },
};

export default assert;
