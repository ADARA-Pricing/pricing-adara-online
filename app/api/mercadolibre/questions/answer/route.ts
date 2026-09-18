import { NextResponse } from "next/server";
import { getConnectedMeliAccount, meliFetch } from "@/lib/mercadolibre";

export async function POST(request: Request) {
  try {
    const account = await getConnectedMeliAccount();
    if (!account) return NextResponse.json({ error: "No hay una cuenta de Mercado Libre conectada." }, { status: 400 });
    const body = await request.json().catch(() => null);
    const questionId = Number(body?.question_id);
    const text = String(body?.text || "").trim();
    if (!Number.isInteger(questionId) || questionId <= 0) return NextResponse.json({ error: "La pregunta no es válida." }, { status: 400 });
    if (!text || text.length > 2000) return NextResponse.json({ error: "La respuesta debe tener entre 1 y 2000 caracteres." }, { status: 400 });

    const answer = await meliFetch("/answers", account, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question_id: questionId, text }),
    });
    return NextResponse.json({ ok: true, answer });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo enviar la respuesta." }, { status: 500 });
  }
}
