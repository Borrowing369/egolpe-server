require("dotenv").config();

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function sanitizeText(text) {
  if (!text || typeof text !== "string") return "";
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

function fallbackAnalysis(message) {
  const lower = message.toLowerCase();

  if (
    lower.includes("pix") ||
    lower.includes("pagar") ||
    lower.includes("pagamento") ||
    lower.includes("chave pix")
  ) {
    return {
      risk: "alto",
      title: "Risco alto",
      confidence: "Alta",
      result:
        "Essa mensagem parece uma tentativa de cobrança suspeita por Pix. O principal problema é que ela tenta fazer você pagar rápido, antes de confirmar se o pedido é verdadeiro.\n\nNão faça nenhum pagamento agora. Confirme diretamente com a pessoa, empresa, advogado, órgão público ou tribunal por um canal oficial que você já conheça. Golpistas costumam usar urgência, promessa de liberação de valor ou ameaça de perda de prazo para pressionar a vítima.\n\nSe você já pagou ou enviou algum dado, salve prints da conversa e entre em contato imediatamente com seu banco.\n\nONDE_CONFIRMAR:\nConfirme pelo telefone oficial, site oficial, aplicativo oficial ou contato antigo já conhecido. Não use número, link, chave Pix ou QR Code enviados na própria mensagem.",
    };
  }

  return {
    risk: "medio",
    title: "Risco médio",
    confidence: "Média",
    result:
      "Essa mensagem precisa ser verificada com cuidado. Ela não traz informações suficientes para concluir com segurança, mas qualquer pedido de clique, cadastro, pagamento ou envio de dados deve ser tratado com atenção.\n\nAntes de agir, confirme a origem por outro canal. Uma mensagem pode parecer verdadeira mesmo quando foi montada para copiar a aparência de uma empresa, banco, loja, advogado ou órgão público.\n\nONDE_CONFIRMAR:\nConfirme usando apenas canais oficiais: aplicativo oficial, site digitado manualmente no navegador, telefone oficial ou contato antigo já salvo.",
  };
}

function extractRiskFromText(text) {
  const lower = text.toLowerCase();

  if (
    lower.includes("risco alto") ||
    lower.includes("golpe provável") ||
    lower.includes("fortes sinais de golpe") ||
    lower.includes("tentativa de golpe") ||
    lower.includes("parece golpe")
  ) {
    return "alto";
  }

  if (
    lower.includes("risco baixo") ||
    lower.includes("baixo risco") ||
    lower.includes("não há sinais relevantes")
  ) {
    return "baixo";
  }

  return "medio";
}

function titleByRisk(risk) {
  if (risk === "alto") return "Risco alto";
  if (risk === "baixo") return "Risco baixo";
  return "Risco médio";
}

function confidenceByRisk(risk) {
  if (risk === "alto") return "Alta";
  if (risk === "baixo") return "Baixa";
  return "Média";
}

app.post("/analisar", async (req, res) => {
  try {
    const message = sanitizeText(req.body?.message);

    if (!message) {
      return res.status(400).json({
        ok: false,
        error: "Mensagem vazia.",
      });
    }

    const systemPrompt = `
Você é a IA do app brasileiro "É Golpe?", um aplicativo simples de proteção contra golpes.

Analise a mensagem enviada pelo usuário e responda em português do Brasil, com linguagem natural, clara, didática e direta.

A resposta será mostrada dentro de um aplicativo. Por isso:
- Não responda em JSON.
- Não use Markdown.
- Não use listas longas.
- Não use cabeçalhos como "Sinais encontrados", "Resumo", "Tipo provável", "Por que é perigoso" ou "Links de referência".
- Não faça resposta robótica.
- Não force categorias antigas.
- Não transforme todo caso em golpe de Pix.
- Não diga que você é IA.
- Não comece com "não posso garantir".
- Não seja genérico.
- Não invente órgão específico se o caso não indicar.
- Não coloque links crus na resposta principal.
- Não use "Reclame Aqui", "CVM", "Polícia Civil" ou "Banco Central" como resposta padrão. Use apenas quando fizer sentido para o caso.

Formato obrigatório:

Primeira linha:
Risco alto
ou
Risco médio
ou
Risco baixo

Depois escreva de 2 a 4 parágrafos curtos, em linguagem natural, explicando:
1. O que provavelmente está acontecendo.
2. Onde está o perigo.
3. O que a pessoa deve evitar agora.

Depois escreva exatamente:
ONDE_CONFIRMAR:

Depois explique, também em linguagem natural, onde a pessoa deve confirmar esse caso específico.

A parte antes de ONDE_CONFIRMAR deve parecer uma orientação humana, natural e didática, não um relatório.

Exemplo de estilo desejado:

Risco alto

Essa mensagem tem fortes sinais de golpe. Ela tenta fazer você pagar uma taxa por Pix para liberar um valor, processo, prêmio ou benefício, e esse tipo de abordagem é muito usado para pressionar a pessoa a agir rápido.

O ponto mais perigoso é que o pagamento está sendo pedido por mensagem, sem confirmação segura da origem. Mesmo que apareça o nome de um advogado, empresa, banco ou tribunal, isso pode ter sido copiado por golpistas.

Não pague agora, não clique em links e não envie documentos, senhas ou códigos. Antes de qualquer atitude, confirme por um canal oficial e independente.

ONDE_CONFIRMAR:
Confirme diretamente com o órgão, empresa, banco, escritório ou pessoa citada usando um telefone oficial, site digitado manualmente ou contato antigo já conhecido. Não use o número, link, QR Code ou chave Pix enviados na própria mensagem.

Regras de classificação:
- Risco alto: pedido de Pix, dinheiro, senha, código, QR Code, link suspeito, urgência, falso suporte, falsa empresa, falso advogado, processo judicial, banco, cripto, carteira digital, promessa de prêmio, aposta, cassino, ameaça ou liberação de valor.
- Risco médio: há sinais de atenção, mas falta contexto ou não há pedido direto de dinheiro/dados.
- Risco baixo: somente quando a mensagem parecer comum e sem sinais relevantes.
`;

    const userPrompt = `
Analise esta mensagem ou texto extraído de print:

"""${message}"""
`;

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.35,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    let result = sanitizeText(completion.choices?.[0]?.message?.content || "");

    if (!result || !result.includes("ONDE_CONFIRMAR:")) {
      const fallback = fallbackAnalysis(message);
      return res.json({
        ok: true,
        source: "fallback",
        risk: fallback.risk,
        title: fallback.title,
        confidence: fallback.confidence,
        result: fallback.result,
      });
    }

    const risk = extractRiskFromText(result);

    return res.json({
      ok: true,
      source: "openai",
      risk,
      title: titleByRisk(risk),
      confidence: confidenceByRisk(risk),
      result,
    });
  } catch (error) {
    console.error("Erro na análise:", error);

    const message = sanitizeText(req.body?.message);
    const fallback = fallbackAnalysis(message);

    return res.json({
      ok: true,
      source: "fallback",
      risk: fallback.risk,
      title: fallback.title,
      confidence: fallback.confidence,
      result: fallback.result,
    });
  }
});

const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

app.get("/", (req, res) => {
  res.send("Servidor É Golpe funcionando.");
});

app.listen(PORT, HOST, () => {
  console.log(`Servidor É Golpe rodando em http://${HOST}:${PORT}`);
  console.log(`Acesse pelo celular usando: http://192.168.0.101:${PORT}`);
});