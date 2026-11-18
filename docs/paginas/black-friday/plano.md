# Plano da página black-friday: Página de planos e preços

Escrito em 2026-11-17. Onde fica: o endereço de planos ou de preços, e a seção de planos dentro da página de vendas. O roteiro completo do tipo está no app, em references/tipos/planos.md.

## Os fatos

| O quê | Valor |
|---|---|
| o nome do produto oferecido | MedChina Pro |
| o que ele é, em uma frase | Prontuário e assistente clínico para terapeutas de Medicina Tradicional Chinesa: grava a consulta com autorização da paciente e prepara a anamnese na estrutura da MTC para a revisão da profissional. |
| para quem é a página, em uma frase | Terapeutas de MTC (acupuntura, auriculoterapia, moxabustão, ventosa, dietoterapia) que chegam por anúncio da Black Friday, pela faixa da home ou por link no WhatsApp; parte já tem conta gratuita. |
| o que a pessoa acabou de comprar ou está comprando | Assinatura mensal do Pro na condição da Black Friday (plano pro-black, cobrado pelo Asaas). |
| o preço que vai ser cobrado, como sai no recibo | R$ 99 hoje e por mês nos 3 primeiros meses |
| o preço normal, se a página mostrar um preço riscado | R$ 299 por mês, o preço de tabela do Pro (plano pro, cobrado hoje no catálogo) |
| se é assinatura: mensal ou anual, e qual período abre marcado | mensal; abre no único período oferecido |
| o valor da renovação, numa assinatura | R$ 197 por mês do 4º ao 12º mês; R$ 299 por mês do 13º em diante (preço de tabela do Pro) |
| os dias de garantia ou de cancelamento simples | 30 |
| o prazo real da oferta, se houver um | 2026-11-27T23:59:59-03:00 (início 2026-11-18T00:00:00-03:00) |
| os planos, com o preço e o período de cada um | [object Object] |
| o plano em destaque | pro-black |
| como cancelar e se há fidelidade ou multa | Sem fidelidade e sem multa: cancela pelo painel quando quiser, mantém o acesso até o fim do mês pago; reembolso integral em 30 dias. |
| o texto do botão principal | Assinar o Pro na Black Friday |
| se o aceite cobra com um clique no meio de pagamento do pedido | não |
| o provedor de pagamento | Asaas (cartão ou PIX), checkout próprio em /assinatura |
| a direção visual, em uma frase que diga o que torna a página deste produto | A Black Friday entra por cima da landing de sempre do MedChina: topo quase preto com o jade da marca por baixo, pílula camelo do desconto, botão menta e a escada de preços como figura própria, porque o preço muda no 4º e no 13º mês. |
| o título da página, escolhido entre as opções de headline.options | Termine o dia sem prontuário para escrever. |
| as figuras: o objeto que cada seção mostra, em figures | [object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object] |
| de onde vem a figura principal: uma versão desenhada para a página (replica), a tela real (tela) ou os componentes do projeto (componentes) | tela |
| o endereço da página para a conferência | /black-friday |

Os campos em [a decidir] são perguntados numa mensagem só, cada decisão com uma sugestão que um sim aceita.

## A direção visual

A Black Friday entra por cima da landing de sempre do MedChina: topo quase preto com o jade da marca por baixo, pílula camelo do desconto, botão menta e a escada de preços como figura própria, porque o preço muda no 4º e no 13º mês.

- A marca: #086761 (jade), #063b39 (jade escuro), #1ec9a4 (menta), #151b1a (tinta), #fbfaf6 (marfim), #d2a571 (camelo, derivado do secundário #c09362 para contraste no escuro); TT Chocolates (títulos), Mulish (texto) (de apps/web/src/app/(marketing)/clinical-source-home.css (Landing DS) e packages/design-tokens/css/green.css; docs/DESIGN.md).
- Escolhido de propósito da lista de vícios: mancha_desfocada.

## Os números e as urgências

| O que a página diz | De onde vem |
|---|---|
| R$ 99 por mês nos 3 primeiros meses, R$ 197 do 4º ao 12º | decisão da dona do produto (outubro), confirmada em 2026-11-17; plano pro-black, migração 0126 |
| R$ 299 por mês do 13º em diante, o preço de tabela do Pro | decisão da dona em 2026-11-17 (volta ao preço de tabela); lido da linha `pro` em plans |
| Black Friday de 18/11 0h a 27/11 23h59 (Brasília) | pedido da dona em 2026-11-17 (início 18/11, até a data da Black Friday); platform_settings.promotion, migração 0126 |
| 66% OFF nos 3 primeiros meses | conta: (299 − 99) / 299 = 66,9%, arredondado para baixo (lib/price-ladder.ts) |
| R$ 2.070 no primeiro ano em vez de R$ 3.588; R$ 1.518 a menos | conta: 3 × 99 + 9 × 197 = 2.070; 12 × 299 = 3.588 (lib/price-ladder.ts, testado) |
| 30 dias de garantia | platform_settings.guarantee (migração 0107), lido por getGuaranteeDays |
| 6.000 minutos de áudio por mês | plans.limits.audio_minutes da linha pro, copiado para pro-black |
| Biografia da fundadora | texto já publicado em /assinar |

## As seções, na ordem

1. O título e uma linha com as condições gerais: o teste e quanto dura, se pede cartão, se há fidelidade
2. O seletor mensal ou anual, com o desconto do anual escrito nele
3. Os cartões dos planos, de três a quatro: o nome, para quem é, o preço com o período, o total do ano e a economia em reais, o chamado e de três a cinco itens que mudam de um plano para outro
4. O plano em destaque, com selo e contorno diferente
5. Uma saída para quem ainda não decidiu: a demonstração ou uma conversa
6. A tabela comparativa completa, com o cabeçalho dos planos grudado no topo durante a rolagem
7. O que fica de fora de todos os planos, como um produto vendido à parte, escrito na própria tabela
8. O plano sob medida, para quem precisa de mais
9. As perguntas frequentes da compra: fidelidade, cancelamento, troca de plano, formas de pagamento, migração, segurança
10. Uma prova curta e o último chamado

## A mecânica

- O seletor troca todos os preços de uma vez; o período que abre marcado é uma decisão do negócio, registrada no plano
- No anual: o preço por mês, o total do ano, a economia em reais e cada forma de pagamento com a sua conta
- O preço riscado do anual é doze vezes o mensal que existe de verdade no seletor
- Os cartões em ordem de preço, a mesma na tabela, com o destaque no plano que serve à maioria
- Cada cartão tem o seu chamado, que leva ao cadastro com o plano e o período escolhidos
- Debaixo do chamado de cada plano, a condição inteira: o que se paga hoje, por quantos meses, em quantas parcelas, quanto custa a renovação e que dá para cancelar
- Numa promoção, cada cartão leva o selo do seu desconto e o bônus com o número de antes e o de agora, e o "a partir de" e o "até" do topo saem dos cartões
- No celular, os cartões em coluna, com o plano em destaque visível sem rolar muito

## A medição

Eventos: `pricing_view`, `billing_toggle`, `plan_select`, `plan_compare_view`, `trial_start`, `checkout_start`, `demo_request`. Cada posição de chamado leva a sua identificação.

## As linhas legais

- O preço de cada plano, o período, a renovação e as restrições do desconto (Decreto 7.962/2013, art. 2, V e VI)
- O preço publicado obriga quem vende e entra no contrato (CDC, art. 30)
- As contas de desconto e de economia verdadeiras (CDC, art. 37, §1)
- O arrependimento em 7 dias numa assinatura feita pela internet (CDC, art. 49)

## Conferir à mão, lendo o código

- [ ] O seletor mensal mostra os preços que fazem a conta do anual
- [ ] A renovação depois de um primeiro período com desconto está escrita
- [ ] Os cartões, a promoção e as perguntas frequentes dizem a mesma coisa sobre o que é grátis e para quem
- [ ] O chamado de cada plano leva ao cadastro com o plano escolhido
- [ ] O "a partir de" e o "até" do topo são o menor preço e o maior desconto dos cartões
- [ ] O começo e o fim da promoção estão escritos no topo e perto da oferta, e o contador termina no fim e mostra dias quando falta mais de um dia
- [ ] A tabela comparativa fica legível no celular

## A conferência automática

- Nenhum cartão com um buraco (`cards_no_holes`)
- Um título principal (h1) (`h1_present`)
- Os preços na primeira tela (`prices_first_screen`)
- Um plano em destaque (`plan_highlighted`)
- As contas de desconto batem (`discount_math`)
- O preço à vista junto das parcelas (`cash_price_shown`)
- O preço riscado é o preço real (`reference_price_true`)
- A renovação escrita (`renewal_shown`)
- A duração do teste grátis (`trial_terms`)
- Como cancelar e se há fidelidade (`cancel_terms_shown`)
- A data e as regras da promoção (`promo_terms_shown`)
- Contador com prazo real (`countdown_real`)
- A janela tem saída (`popup_dismissable`)
- Nenhuma janela cobre a página na chegada (`popup_on_arrival`)
- Números que não começam em zero (`numbers_not_zero`)
- Os números e as urgências têm origem (`claims_have_origin`)
- Nenhum dado de exemplo esquecido (`placeholder_data`)
- Quem vende identificado (`supplier_identified`)
- As linhas legais (`legal_lines`)
- Os vícios de IA (`ai_defaults`)
- As cores e as letras da marca (`off_brand`)
- Nada se mexe sozinho com o pedido de menos movimento (`reduced_motion`)
- Nada passa da largura do celular (`mobile_fits`)
- Texto legível no celular (`text_legible`)
- Botões e links fáceis de tocar (`tap_targets`)
- O contraste do texto (`contrast_ok`)
- O texto cabe nos botões (`controls_fit`)
- Imagens leves (`images_light`)
- Imagens com texto alternativo (`images_alt`)

## Modelos deste tipo

- Juridiq: a página de planos com mensal e anual (vista em 2026-11-07): anual aberto por padrão, com o riscado igual a doze vezes o mensal; por plano: média mensal, total no cartão, economia em reais e PIX, cada um com a sua conta; quatro planos do mais caro ao mais barato, com o segundo em destaque; tabela comparativa com o cabeçalho grudado e o que fica de fora escrito; agenda de demonstração embutida que separa cliente de quem ainda não é.
- JuriChat: a página de vendas do atendimento por WhatsApp (vista em 2026-11-07): as dores do dia a dia em quatro cartões antes da solução; a história de uma cliente em quatro passos, numa conversa presa na tela; os painéis do atendente e do gestor com números de exemplo; o que depende do plano escrito junto do recurso; o teste em destaque no topo e os 7 dias escritos nos planos.
- Hostinger: a Black Friday na página inicial, com o contador e os planos (vista em 2026-11-17): a promoção entra por cima da página de sempre: a faixa, o topo, o bônus nos cartões e as outras ofertas; o topo com o evento, o maior desconto, o preço de entrada e um botão só; debaixo do botão de cada plano, o que se paga hoje, as parcelas, a renovação e o cancelamento; o bônus da campanha com o número de antes e o de agora, igual em todos os cartões; o contador termina na mesma hora para todos, e o topo é testado com e sem ele.
