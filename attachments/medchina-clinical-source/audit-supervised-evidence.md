# Auditoria focada — IA supervisionada

## Evidência capturada

- Captura fornecida nesta revisão: `/workspace/scratch/e801c1e6dcda/upload/01-image.png`
- Superfície: landing page pública, demonstração de conversa → anamnese preparada.
- Passo 1 — compreensão e revisão da extração.
- Saúde observada: regular.

## Pontos fortes

- A comparação lado a lado comunica a ideia central de transformação.
- A paleta, os cantos e a tipografia estão coerentes com o restante do MedChina.
- Os três estados de evidência já introduzem o conceito de supervisão.

## Problemas observados

1. A conversa e os campos parecem painéis independentes; não existe vínculo visual ou acionável entre fonte e resultado.
2. O excesso de espaço vazio enfraquece a demonstração e reduz a percepção de inteligência aplicada.
3. “Início há cerca de dois meses” não é sustentado pelo trecho mostrado, contradizendo a promessa de rastreabilidade.
4. Player, status e metadados têm baixa prioridade visual e pouca capacidade de orientar a revisão.
5. A hierarquia do cabeçalho direito é dividida entre extremos, dificultando a leitura como uma única tarefa clínica.

## Riscos de acessibilidade visíveis

- Textos auxiliares e badges estavam pequenos para leitura confortável.
- O controle de reprodução precisava de estado e rótulo claros.
- Cor não deveria ser a única pista para diferenciar evidência clara, atenção e ausência.

## Mudanças implementadas

- Destaques semânticos nos trechos efetivamente usados pela organização.
- Player compacto e interativo com estado de reprodução, duração e autorização.
- Ponte central “IA organiza” para explicitar causa e efeito.
- Campos com ícone, texto, status acompanhado por símbolo e ação “Ouvir origem”.
- Remoção da afirmação temporal sem suporte no trecho.
- Rodapé explícito informando que nada foi finalizado automaticamente.
- Responsividade em coluna, com a ponte rotacionada para manter a sequência de leitura.

## Limites da evidência

- A captura permite avaliar hierarquia, densidade e conteúdo, mas não comprova foco de teclado, anúncio por leitor de tela ou contraste calculado.
- A nova implementação passou por lint, build e teste de HTML renderizado.
- A inspeção visual automatizada da implementação ficou bloqueada porque o navegador de verificação não conseguiu abrir a prévia, embora o serviço estivesse saudável.

