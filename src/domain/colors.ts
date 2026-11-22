// Цвета полимерного покрытия панелей и фасонных элементов по каталогу RAL.

export interface RalColor {
  id: string;
  name: string;
  hex: string;
}

export const RAL: RalColor[] = [
  { id: '9003', name: 'сигнальный белый', hex: '#ecece7' },
  { id: '9002', name: 'серо-белый', hex: '#d7d5cb' },
  { id: '7035', name: 'светло-серый', hex: '#c5c7c4' },
  { id: '9006', name: 'бело-алюминиевый', hex: '#a1a1a0' },
  { id: '7004', name: 'сигнальный серый', hex: '#9b9b9b' },
  { id: '7024', name: 'графитовый серый', hex: '#45494e' },
  { id: '5005', name: 'сигнальный синий', hex: '#005387' },
  { id: '5002', name: 'ультрамарин', hex: '#00387b' },
  { id: '6005', name: 'зелёный мох', hex: '#114232' },
  { id: '3005', name: 'винно-красный', hex: '#59191f' },
  { id: '3020', name: 'транспортный красный', hex: '#c1121c' },
  { id: '2004', name: 'оранжевый', hex: '#e25303' },
  { id: '1014', name: 'слоновая кость', hex: '#ddc49a' },
  { id: '1018', name: 'цинково-жёлтый', hex: '#faca30' },
  { id: '8017', name: 'шоколадно-коричневый', hex: '#442f29' },
];

export function ral(id: string): RalColor {
  return RAL.find((c) => c.id === id) ?? RAL[0];
}

export function ralLabel(id: string): string {
  const c = ral(id);
  return `RAL ${c.id} ${c.name}`;
}
