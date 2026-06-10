import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

export async function POST(req: NextRequest) {
  const { tokenAddress } = await req.json();

  const client = new OpenAI({
    apiKey: process.env.AZURE_API_KEY,
    baseURL: `${process.env.AZURE_ENDPOINT}/openai`,
    defaultQuery: { 'api-version': '2024-05-01-preview' },
    defaultHeaders: { 'api-key': process.env.AZURE_API_KEY },
  });

  try {
    const thread = await client.beta.threads.create();
    console.log('Thread created:', thread.id);

    await client.beta.threads.messages.create(thread.id, {
      role: 'user',
      content: `Analyze this token: ${tokenAddress}`,
    });

    const run = await client.beta.threads.runs.createAndPoll(thread.id, {
      assistant_id: 'asst_oWEf2M1qHnexlREgPAEicMW',
    });

    console.log('Run status:', run.status);

    const messages = await client.beta.threads.messages.list(thread.id);
    const lastMsg = messages.data[0].content[0];
    const result = lastMsg.type === 'text' ? lastMsg.text.value : 'No response';

    return NextResponse.json({ result });
  } catch (error) {
    console.error('Full error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}