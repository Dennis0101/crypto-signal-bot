import { Message } from 'discord.js';
import { coinSelectMenusDual } from '../ui/components.js';

export async function handleCoinRoot(msg: Message) {
  const menus = await coinSelectMenusDual();

  const ch: any = msg.channel;
  if (ch && typeof ch.send === 'function') {
    await ch.send({
      content: '🔍 분석할 코인을 선택하세요 (상위 25 · 단타 10)',
      components: menus,
    });
  }
}
