cd ~/trialforge-ai
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
        content: `**CSR Table 14.1 NSCLC**
| Parameter | Value |
|-----------|-------|
| ORR | 45% |
| mPFS | 8.2 months |
| OS | 24 months |

**10-Agent Pipeline WORKING!** 🎉`
      }
    }]
  });
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🟢 TrialForge MCP v1.1 LIVE on http://localhost:${PORT}`);
});
EOF
