<<<<<<< HEAD
cd ~/trialforge-ai
cat > src/index.js << 'EOF'
const express = require('express');
const cors = require('cors');
=======
import express from 'express';
import cors from 'cors';
>>>>>>> 2184744 (MCP backend v1.1)
const app = express();

app.use(cors());
app.use(express.json());

app.post('/mcp/v1/chat/completions', (req, res) => {
  console.log('✅ MCP HIT:', req.body.messages[0].content);
  res.json({
    choices: [{
      message: {
<<<<<<< HEAD
        content: `**CSR Table 14.1 NSCLC**
| Parameter | Value |
|-----------|-------|
| ORR | 45% |
| mPFS | 8.2 months |
| OS | 24 months |

**10-Agent Pipeline WORKING!** 🎉`
=======
        content: '**MCP v1.1 WORKING! User: "' + req.body.messages[0].content + '" 🎉'
>>>>>>> 2184744 (MCP backend v1.1)
      }
    }]
  });
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🟢 TrialForge MCP v1.1 LIVE on http://localhost:${PORT}`);
});
