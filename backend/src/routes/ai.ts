import { Router, Response } from 'express';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { asyncHandler, createError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

const router = Router();

// POST /api/ai/analyze-emergency — AI-assisted emergency intake
router.post(
  '/analyze-emergency',
  authenticate,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { description } = req.body;

    if (!description || description.trim().length < 10) {
      throw createError('Please provide a description of at least 10 characters', 400);
    }

    try {
      const geminiApiKey = process.env.GEMINI_API_KEY;

      if (geminiApiKey && geminiApiKey !== 'your_gemini_api_key_here') {
        // Real Gemini API call
        const { GoogleGenerativeAI } = await import('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(geminiApiKey);
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

        const prompt = `You are an emergency medical intake assistant. A patient describes their emergency:

"${description}"

Analyze this and respond ONLY with a valid JSON object (no markdown, no code blocks):
{
  "emergencyCategory": "one of: cardiac_arrest, stroke, trauma, respiratory, obstetric, pediatric, burns, poisoning, diabetic, psychiatric, other",
  "suggestedAmbulanceType": "one of: BLS, ALS, CCT, NICU, BARIATRIC",
  "urgencyLevel": "one of: critical, high, medium, low",
  "keySymptoms": ["symptom1", "symptom2"],
  "suggestedCapabilities": ["capability1", "capability2"],
  "missingInformation": ["what info is missing to better assess"],
  "aiNote": "Brief note explaining your classification",
  "disclaimer": "AI-generated suggestion only. Patient must verify all information. Do not delay emergency response."
}

IMPORTANT: 
- Do NOT diagnose or provide medical advice
- Only classify for dispatch purposes
- Always include the disclaimer`;

        const result = await model.generateContent(prompt);
        const text = result.response.text().trim();

        let parsed: any;
        try {
          // Extract JSON if wrapped in anything
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
        } catch {
          throw new Error('Invalid AI response format');
        }

        return res.json({
          success: true,
          data: {
            ...parsed,
            source: 'gemini-ai',
            isAiGenerated: true,
            disclaimer: 'AI-generated classification only. Patient must verify. Do not delay emergency response for AI analysis.',
          },
        });
      }

      // Fallback: rule-based analysis
      throw new Error('Gemini API not configured');
    } catch (error: any) {
      logger.warn('AI analysis failed, using rule-based fallback:', error.message);

      // Rule-based fallback
      const desc = description.toLowerCase();
      let emergencyCategory = 'other';
      let suggestedAmbulanceType = 'ALS';
      let urgencyLevel = 'high';

      if (desc.includes('chest pain') || desc.includes('heart attack') || desc.includes('cardiac') || desc.includes('heart') || desc.includes('palpitation')) {
        emergencyCategory = 'cardiac_arrest';
        suggestedAmbulanceType = 'ALS';
        urgencyLevel = 'critical';
      } else if (desc.includes('stroke') || desc.includes('facial droop') || desc.includes('face droop') || desc.includes('slurred speech') || desc.includes('arm weakness') || desc.includes('cannot lift') || desc.includes('paralysis') || desc.includes('numbness')) {
        emergencyCategory = 'stroke';
        suggestedAmbulanceType = 'ALS';
        urgencyLevel = 'critical';
      } else if (desc.includes('accident') || desc.includes('trauma') || desc.includes('injury') || desc.includes('fracture')) {
        emergencyCategory = 'trauma';
        suggestedAmbulanceType = 'ALS';
        urgencyLevel = 'high';
      } else if (desc.includes('breathing') || desc.includes('breath') || desc.includes('asthma')) {
        emergencyCategory = 'respiratory';
        suggestedAmbulanceType = 'ALS';
        urgencyLevel = 'critical';
      } else if (desc.includes('pregnant') || desc.includes('labour') || desc.includes('delivery')) {
        emergencyCategory = 'obstetric';
        suggestedAmbulanceType = 'ALS';
        urgencyLevel = 'high';
      } else if (desc.includes('child') || desc.includes('baby') || desc.includes('infant') || desc.includes('pediatric')) {
        emergencyCategory = 'pediatric';
        suggestedAmbulanceType = 'NICU';
        urgencyLevel = 'critical';
      } else if (desc.includes('burn') || desc.includes('fire')) {
        emergencyCategory = 'burns';
        suggestedAmbulanceType = 'ALS';
        urgencyLevel = 'high';
      } else if (desc.includes('poison') || desc.includes('overdose') || desc.includes('toxic')) {
        emergencyCategory = 'poisoning';
        suggestedAmbulanceType = 'ALS';
        urgencyLevel = 'high';
      } else if (desc.includes('diabetic') || desc.includes('sugar') || desc.includes('insulin')) {
        emergencyCategory = 'diabetic';
        suggestedAmbulanceType = 'BLS';
        urgencyLevel = 'medium';
      }

      return res.json({
        success: true,
        data: {
          emergencyCategory,
          suggestedAmbulanceType,
          urgencyLevel,
          keySymptoms: [],
          suggestedCapabilities: [],
          missingInformation: ['Exact location', 'Number of patients', 'Consciousness level'],
          aiNote: 'Rule-based classification (Gemini AI not configured)',
          source: 'rule-based-fallback',
          isAiGenerated: false,
          disclaimer: 'Rule-based classification only. Patient must verify. Do not delay emergency response.',
        },
      });
    }
  })
);

export default router;
