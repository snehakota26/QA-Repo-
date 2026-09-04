const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const reportsDir = path.join(rootDir, 'reports');
const jsonFile = path.join(reportsDir, 'cucumber-report.json');
const htmlFile = path.join(reportsDir, 'cucumber-report.html');

fs.mkdirSync(reportsDir, { recursive: true });

function safeReadJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    return [];
  }
}

const data = safeReadJson(jsonFile);
const features = Array.isArray(data) ? data : [data];

const rows = [];
let passed = 0;
let failed = 0;
let total = 0;

for (const feature of features) {
  if (!feature || !Array.isArray(feature.elements)) continue;

  for (const scenario of feature.elements) {
    total += 1;
    const status = scenario.steps && scenario.steps.some(step => step.result && step.result.status === 'failed')
      ? 'failed'
      : 'passed';

    if (status === 'passed') passed += 1;
    else failed += 1;

    rows.push(`
      <tr>
        <td>${escapeHtml(feature.name || 'Feature')}</td>
        <td>${escapeHtml(scenario.name || 'Scenario')}</td>
        <td><span class="badge ${status}">${status}</span></td>
        <td>${scenario.steps ? scenario.steps.length : 0}</td>
      </tr>
    `);
  }
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>BDD Report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; background: #f4f7fb; color: #1f2937; }
    .container { max-width: 1100px; margin: 0 auto; }
    .header { background: #111827; color: white; padding: 24px; border-radius: 12px; margin-bottom: 20px; }
    .summary { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }
    .card { background: white; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); padding: 16px 20px; min-width: 150px; }
    .card h3 { margin: 0 0 8px; color: #6b7280; font-size: 14px; }
    .card strong { font-size: 28px; }
    .badge { display: inline-block; padding: 5px 10px; border-radius: 999px; font-size: 12px; font-weight: bold; text-transform: uppercase; }
    .badge.passed { background: #dcfce7; color: #166534; }
    .badge.failed { background: #fee2e2; color: #991b1b; }
    table { width: 100%; border-collapse: collapse; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    th, td { text-align: left; padding: 12px 14px; border-bottom: 1px solid #e5e7eb; }
    th { background: #eef2ff; }
    .footer { margin-top: 20px; color: #4b5563; font-size: 13px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>BDD Test Report</h1>
    </div>

    <div class="summary">
      <div class="card">
        <h3>Total</h3>
        <strong>${total}</strong>
      </div>
      <div class="card">
        <h3>Passed</h3>
        <strong>${passed}</strong>
      </div>
      <div class="card">
        <h3>Failed</h3>
        <strong>${failed}</strong>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Feature</th>
          <th>Scenario</th>
          <th>Status</th>
          <th>Steps</th>
        </tr>
      </thead>
      <tbody>
        ${rows.join('') || '<tr><td colspan="4">No scenario results found.</td></tr>'}
      </tbody>
    </table>

    <div class="footer">
      Generated from: ${path.basename(jsonFile)}
    </div>
  </div>
</body>
</html>`;

fs.writeFileSync(htmlFile, html, 'utf8');
console.log(`HTML report generated: ${htmlFile}`);

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
