# Verificação — consentimento do paciente por QR

Data: 16 de julho de 2026.

## Resultado

O fluxo público `/consentir` foi verificado no build de produção. A pessoa atendida consegue ler os três termos, usar o atalho simétrico para autorizar todas as finalidades ou não autorizar nenhuma, revisar cada decisão individualmente, identificar-se e registrar tudo em uma única submissão.

O atalho “Autorizar as três finalidades” marcou exatamente:

- `audio-recording`;
- `ai-processing`;
- `clinical-images`.

O botão final começou desabilitado, tornou-se disponível somente após as três decisões, nome e confirmação final, e a submissão única chegou ao estado de sucesso.

## Viewports e acessibilidade

Verificado em:

- desktop 1440 px, modo claro;
- mobile 390 px, modos claro e escuro;
- mobile 320 px, modo claro;
- estado de link inválido/expirado nos mesmos modos principais.

Em todos os cenários:

- resposta HTTP 200;
- nenhum overflow horizontal;
- nenhum botão sem nome acessível;
- nenhuma violação séria ou crítica no axe;
- idioma do documento `pt-BR`;
- foco e regiões live presentes nos estados de resultado.

## Evidência e limites

O navegador usou respostas HTTP locais determinísticas para percorrer o happy path sem criar dados clínicos reais. A persistência, concorrência, expiração, rotação de token, idempotência e os três registros atômicos foram validados separadamente contra o Supabase configurado, com 165 testes SQL aprovados no gate remoto.

Os textos jurídicos atualmente semeados no banco continuam provisórios e precisam de revisão jurídica antes do lançamento. A implementação fortalece a evidência técnica, mas não substitui a definição jurídica do conteúdo e da base legal aplicável.
