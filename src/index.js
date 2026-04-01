cd ~/mcp-clean
cat > index.js << 'EOF'
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
        content: `**MCP v1.3 WORKING on PORT 4000!** 🎉\nUser: "${req.body.messages[0].content}"`
      }
    }]
  });
});

const PORT = 4000;
app.listen(PORT, () => {
  console.log(`🟢 MCP v1.3 LIVE on http://localhost:${PORT}`);
});
EOF
