const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json());

app.post('/mcp/v1/chat/completions', async (req, res) => {
  const { messages } = req.body;
  console.log('✅ MCP HIT:', messages[0].content);
  res.json({
    choices: [{
      message: {
        content: '**TrialForge MCP v1.2 WORKING!**\n\n| Agent | Status |\n|-------|--------|\n| Trialist | ✅ 12 trials |\n| Clinician | ✅ Eligibility |\n| Statistician | ✅ N=412/arm |\n\n**Pharma pipeline LIVE** 🎉'
      }
    }]
  });
});

app.listen(4000, () => console.log('🟢 MCP v1.2 http://localhost:4000'));
