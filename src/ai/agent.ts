import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

export interface AnalysisResult {
  summary: string[];
  risk: 'Low' | 'Medium' | 'High';
  reason: string;
}

export async function analyzeDiff(diff: string): Promise<AnalysisResult> {
  // If the diff is empty or too large, we might want to handle it.
  // For now, let's assume reasonable size.

  const prompt = `
    You are a senior software engineer reviewing a Pull Request.
    Analyze the following git diff and provide:
    1. A summary of changes (max 3 bullet points).
    2. A risk assessment (Low, Medium, or High).
    3. A brief reason for the risk level.

    Return the response in JSON format like this:
    {
      "summary": ["point 1", "point 2", "point 3"],
      "risk": "Medium",
      "reason": "Modifies authentication logic without adding tests."
    }

    Diff:
    ${diff.substring(0, 30000)} // Truncate to avoid token limits if necessary
  `;

  try {
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    // Clean up the response to ensure it's valid JSON
    const jsonString = responseText.replace(/```json/g, '').replace(/```/g, '').trim();

    return JSON.parse(jsonString);
  } catch (error) {
    console.error('Error analyzing diff with Gemini:', error);
    return {
      summary: ['Unable to analyze diff due to an error.'],
      risk: 'Low',
      reason: 'AI Analysis Failed',
    };
  }
}
