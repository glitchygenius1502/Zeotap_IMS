// tests/rcaValidation.test.js

class ClosedState { 
  validateTransition(payload) { 
    if (!payload || !payload.root_cause || !payload.fix_applied) {
      throw new Error('State transition rejected: Mandatory RCA object is missing or incomplete');
    }
    return true; 
  } 
}

describe('RCA Validation Logic (State Pattern)', () => {
  const validator = new ClosedState();

  test('Should reject if RCA payload is entirely missing', () => {
    expect(() => validator.validateTransition(null)).toThrow('Mandatory RCA object is missing or incomplete');
  });

  test('Should reject if root_cause is missing', () => {
    const badPayload = { fix_applied: "Restarted server" };
    expect(() => validator.validateTransition(badPayload)).toThrow();
  });

  test('Should reject if fix_applied is missing', () => {
    const badPayload = { root_cause: "Memory Leak" };
    expect(() => validator.validateTransition(badPayload)).toThrow();
  });

  test('Should pass if valid RCA payload is provided', () => {
    const goodPayload = { root_cause: "Memory Leak", fix_applied: "Increased RAM and patched leak" };
    expect(validator.validateTransition(goodPayload)).toBe(true);
  });
});