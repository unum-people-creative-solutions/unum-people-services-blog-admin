// Textos da cobrança (cobranca-e-plano-do-cliente, RF2-21–RF2-23).
// As datas chegam como AAAA-MM-DD em horário de Brasília: só reordenamos o texto,
// sem Date, para o fuso do navegador não voltar um dia.

export function formatarData(data: string): string {
  const [, mes, dia] = data.split('-');
  return `${dia}/${mes}`;
}

function diasNoMes(ano: number, mes: number): number {
  if (mes === 2) {
    const bissexto = (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
    return bissexto ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(mes) ? 30 : 31;
}

const doisDigitos = (n: number) => String(n).padStart(2, '0');

// "continua no ar até" usa a véspera de fora_do_ar_em (DV-19).
export function diaAnterior(data: string): string {
  let [ano, mes, dia] = data.split('-').map(Number);
  dia -= 1;
  if (dia === 0) {
    mes -= 1;
    if (mes === 0) {
      mes = 12;
      ano -= 1;
    }
    dia = diasNoMes(ano, mes);
  }
  return `${ano}-${doisDigitos(mes)}-${doisDigitos(dia)}`;
}

export function formatarReais(valor: number): string {
  const [inteiro, centavos] = valor.toFixed(2).split('.');
  const comMilhar = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `R$ ${comMilhar},${centavos}`;
}

// "Páginas" sempre; "CRM" e "blog" quando a conta tem (BP-T D-3).
export function ferramentasCitadas(servicos: string[]): string {
  const nomes = ['Páginas'];
  if (servicos.includes('crm')) nomes.push('CRM');
  if (servicos.includes('blog')) nomes.push('blog');
  if (nomes.length === 1) return nomes[0];
  return `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
}
