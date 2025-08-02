process.env.GOOGLE_SERVICE_ACCOUNT_BASE64 = Buffer.from('{}').toString('base64');
const { interpretYesNo } = require('..');

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    console.error(`${message} - expected ${expected}, got ${actual}`);
    process.exit(1);
  }
}

const cases = [
  { input: "yes that's correct", expected: true },
  { input: "no that's not correct", expected: false },
  { input: "nah that's wrong", expected: false },
  { input: "yeah sure", expected: true },
  { input: "nope correct", expected: false },
];

cases.forEach((c, i) => {
  assertEqual(interpretYesNo(c.input), c.expected, `Case ${i + 1}`);
});

console.log('interpretYesNo tests passed');
