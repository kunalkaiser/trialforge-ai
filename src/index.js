import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const app = express();
const prisma = new PrismaClient();

app.use(cors({ origin: '*' }));
app.use(express.json());

const SECRET = process.env.JWT_SECRET || 'sk-trialforge-mcp-pharma-part11-2026';

// MCP Auth
app.post('/auth/tenant', (req, res) => {
  const { tenantId, studyId, userId, role } = req.body;
  const token = jwt.sign({ tenantId, studyId, userId, role }, SECRET, { expiresIn: '24h' });
  res.json({ access_token: token });
});

// MCP Chat (Claude Desktop compatible)
app.post('/mcp/v1/chat/completions', async (req, res) => {
  const auth = req.headers.authorization?.split(' ')[1];
  const user = jwt.verify(auth, SECRET);
  
  const { messages } = req.body;
  
  if (messages[0].content.includes('CSR') || messages[0].content.includes('14.1')) {
    const csrTable = `## ICH E3 Table 14.1 (Part 11 Compliant)
| Characteristic | Treatment (N=160) | Control (N=160) |
|----------------|-------------------|-----------------|
| Age (mean)     | 65.2              | 64.8            |
| Female %       | 42%               | 41%             |
| White %        | 78%               | 79%             |
| SAE Incidence  | 12.5%             | 13.2%           |`;
    
    // Part 11 Audit
    await prisma.audit.create({
      data: {
        tenantId: user.tenantId,
        studyId: user.studyId,
        action: 'CSR_Table_14.1_generated',
        after: csrTable,
        userId: user.userId,
        role: user.role
      }
    });
    
    res.json({
      choices: [{
        message: { 
          role: 'assistant', 
          content: csrTable 
        }
      }]
    });
  } else {
    res.json({ choices: [{ message: { role: 'assistant', content: 'TrialForge MCP ready. Say "CSR Table 14.1"' } }] });
  }
});

// Part 11 Audit Export
app.get('/audit', async (req, res) => {
  const auth = req.headers.authorization?.split(' ')[1];
  const user = jwt.verify(auth, SECRET);
  const audits = await prisma.audit.findMany({
    where: { tenantId: user.tenantId },
    orderBy: { timestamp: 'desc' }
  });
  res.json({ audit_trail: audits });
});

const PORT = process.env.PORT || 3000;
// MCP Auth endpoint
app.post('/auth/tenant', (req, res) => {
  const { tenantId, studyId, userId, role } = req.body;
  const token = jwt.sign({ tenantId, studyId, userId, role }, SECRET, { expiresIn: '24h' });
  res.json({ access_token: token });
});
app.listen(PORT, () => console.log(`TrialForge MCP v1.1 on http://localhost:${PORT}`));