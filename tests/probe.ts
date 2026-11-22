// Диагностический прогон: печатает подобранные сечения и массы по шаблонам.
import { newProject, BUILDING_TYPES } from '../src/domain/presets';
import { calcStructure } from '../src/domain/structure';

const only = process.argv[2];
for (const type of BUILDING_TYPES) {
  if (only && only !== type) continue;
  const p = newProject(type);
  const t0 = performance.now();
  const r = calcStructure(p);
  const dt = performance.now() - t0;
  const b = p.building;
  console.log(`\n=== ${type}: ${b.width}×${b.length}×${b.height}, ${r.tech}/${r.scheme}/${r.baseFix}, шаг ${r.step.toFixed(2)}, ${dt.toFixed(0)} мс, итераций ${r.iterations}, сочетаний ${r.comboCount}`);
  if (!r.ok) {
    console.log('ОШИБКА', r.error);
    continue;
  }
  console.log(`  снег ${r.loads.snow.toFixed(2)} кПа, ветер ${r.loads.wind.toFixed(2)} кПа, покрытие ${r.loads.roofDead.toFixed(2)}`);
  for (const g of r.groups) {
    console.log(`  ${g.label.padEnd(32)} ${g.section.padEnd(18)} ${(g.util * 100).toFixed(0).padStart(3)}%  ${g.governing} [${g.combo}] N=${g.N.toFixed(0)} M=${g.M.toFixed(0)} lef=${g.lefIn.toFixed(1)}/${g.lefOut.toFixed(1)} λ=${g.lambdaX.toFixed(0)}/${g.lambdaY.toFixed(0)}`);
  }
  for (const s of r.secondary) {
    console.log(`  ${s.label.padEnd(32)} ${s.section.padEnd(18)} ${(s.util * 100).toFixed(0).padStart(3)}%  ×${s.count}  ${s.basis}`);
  }
  console.log(`  прогиб ${(r.sls.deflection * 1000).toFixed(0)}/${(r.sls.deflectionLimit * 1000).toFixed(0)} мм, смещение ${(r.sls.drift * 1000).toFixed(0)}/${(r.sls.driftLimit * 1000).toFixed(0)} мм`);
  for (const f of r.foundationLoads) {
    console.log(`  фундамент ${f.label}: ×${f.count} Nmax=${f.nMax.toFixed(0)} Nmin=${f.nMin.toFixed(0)} M=${f.mMax.toFixed(0)} Q=${f.qMax.toFixed(0)}`);
  }
  const m = r.mass;
  console.log(`  МАССА ${(m.total / 1000).toFixed(2)} т = ${m.kgPerM2.toFixed(1)} кг/м² (труба ${(m.tube / 1000).toFixed(1)}, двутавр ${(m.ibeam / 1000).toFixed(1)}, швеллер ${(m.channel / 1000).toFixed(1)}, фермы ${(m.truss / 1000).toFixed(1)})`);
  for (const w of r.warnings) console.log('  ! ' + w);
}
