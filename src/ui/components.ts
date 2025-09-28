// components.ts
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import { CONFIG } from '../config.js';
export const BTN = { ANALYZE:'analyze', LONG:'long', SHORT:'short', REFRESH:'refresh' } as const;
export const SEL = { SYMBOL:'sel_symbol', TF:'sel_tf' } as const;

export function rowsButtons() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(BTN.ANALYZE).setLabel('Analyze').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(BTN.LONG).setLabel('Long').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(BTN.SHORT).setLabel('Short').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(BTN.REFRESH).setLabel('Refresh').setStyle(ButtonStyle.Secondary),
  );
}
export function rowsSelects(symbol:string, tf:string) {
  const sym = new StringSelectMenuBuilder().setCustomId(SEL.SYMBOL).setPlaceholder(`심볼(${symbol})`)
    .addOptions(CONFIG.SYMBOL_CHOICES.map(s=>({ label:s, value:s, default:s===symbol })));
  const tfs = new StringSelectMenuBuilder().setCustomId(SEL.TF).setPlaceholder(`타임프레임(${tf})`)
    .addOptions(CONFIG.TF_CHOICES.map(t=>({ label:t, value:t, default:t===tf })));
  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(sym),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(tfs)
  ];
}
