import { describe, expect, it } from 'vitest';
import { getProvider, isProviderId, listProviders, PROVIDERS } from '../src/providers.js';
import type { ChatMessage } from '../src/ai.js';

const signal = new AbortController().signal;
const msgs: ChatMessage[] = [{ role: 'user', content: 'oi' }];

describe('providers', () => {
  it('registra deepseek, openai, codex e gemini', () => {
    expect(listProviders().map((p) => p.id)).toEqual(['deepseek', 'openai', 'codex', 'gemini']);
    expect(isProviderId('deepseek')).toBe(true);
    expect(isProviderId('nao-existe')).toBe(false);
  });

  it('getProvider cai no deepseek quando id desconhecido', () => {
    expect(getProvider('xyz').id).toBe('deepseek');
    expect(getProvider('openai').id).toBe('openai');
  });

  it('deepseek gera request OpenAI-compativel com Bearer e JSON mode', () => {
    const p = getProvider('deepseek');
    const req = p.buildRequest('sk-abc', 'deepseek-chat', msgs, { json: true, temperature: 0.3 }, signal);
    expect(req.url).toBe('https://api.deepseek.com/chat/completions');
    expect(req.headers.Authorization).toBe('Bearer sk-abc');
    expect(req.method).toBe('POST');
    const body = JSON.parse(req.body);
    expect(body.model).toBe('deepseek-chat');
    expect(body.response_format.type).toBe('json_object');
    expect(body.temperature).toBe(0.3);
  });

  it('codex usa endpoint OpenAI-compativel', () => {
    const p = getProvider('codex');
    expect(p.defaultModel.length).toBeGreaterThan(0);
    const req = p.buildRequest('sk-x', 'gpt-4o', msgs, {}, signal);
    expect(req.url).toContain('/chat/completions');
  });

  it('gemini gera generateContent com x-goog-api-key', () => {
    const p = getProvider('gemini');
    const req = p.buildRequest('KEY', 'gemini-2.0-flash', msgs, { json: true }, signal);
    expect(req.url).toContain('/models/gemini-2.0-flash:generateContent');
    expect(req.headers['x-goog-api-key']).toBe('KEY');
    const body = JSON.parse(req.body);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
  });

  it('parseResponse extrai o texto de respostas OpenAI-compativels', () => {
    const p = getProvider('deepseek');
    expect(p.parseResponse({ choices: [{ message: { content: 'resposta' } }] })).toBe('resposta');
  });

  it('parseResponse extrai o texto de respostas do Gemini', () => {
    const p = getProvider('gemini');
    expect(p.parseResponse({ candidates: [{ content: { parts: [{ text: 'resposta' }] } }] })).toBe('resposta');
  });

  it('parseResponse lanca erro quando vazio', () => {
    expect(() => getProvider('deepseek').parseResponse({})).toThrow();
    expect(() => getProvider('gemini').parseResponse({})).toThrow();
  });

  it('todos os providers tem label e defaultModel', () => {
    for (const p of Object.values(PROVIDERS)) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.defaultModel.length).toBeGreaterThan(0);
    }
  });
});
