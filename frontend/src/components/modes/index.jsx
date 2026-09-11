import React from 'react';
import { BilanciaPage } from './BilanciaPage';
import { BollitorePage } from './BollitorePage';
import { CbtPage } from './CbtPage';
import { SpigaPage } from './SpigaPage';
import { TurboPage } from './TurboPage';
import { PuliziaPage } from './PuliziaPage';
import { RiscaldaPage } from './RiscaldaPage';
import { UovaPage } from './UovaPage';
import { VaromaPage } from './VaromaPage';

export { BilanciaPage, BollitorePage, CbtPage, SpigaPage, TurboPage, PuliziaPage, RiscaldaPage, UovaPage, VaromaPage };

export const MODE_COMPONENTS = {
    bilancia: BilanciaPage,
    bollitore: BollitorePage,
    turbo: TurboPage,
    spiga: SpigaPage,
    pulizia: PuliziaPage,
    riscalda: RiscaldaPage,
    cbt: CbtPage,
    uova: UovaPage,
    varoma: VaromaPage,
};
