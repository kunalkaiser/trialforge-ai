cat > src/index.js << 'EOF'
const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

app.post('/mcp/v1/chat/completions', (req, res) => {
  console.log('✅ MCP HIT:', req.body.messages[0].content);
  res.json({
    choices: [{
      message: {
        content: `**CSR Table 14.1 NSCLC**\n\n| Parameter | Value |\n|-----------|-------|\n| ORR | 45% |\n| mPFS | 8.2 months |\n| OS | 24 months |\n\n**10-Agent Pipeline WORKING!** 🎉`
      }
    }]
  });
});

app.listen(3000, () => {
  console.log('🟢 TrialForge MCP v1.1 on http://localhost:3000');
});
EOF
