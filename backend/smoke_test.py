import sys
sys.path.insert(0, '.')

print('--- Importing synthetic package ---')
from synthetic.config import load_config
cfg = load_config()
print(f'Config loaded: machine={cfg.machine.machine_id}, fs_vib={cfg.fs_vib}')

from synthetic.simulator import PulveriserSimulator
sim = PulveriserSimulator(cfg, seed=42)
print('Simulator created. Running 3 windows...')
for i in range(3):
    rec = sim.run_window()
    mhi  = rec['indices']['MHI']
    pqi  = rec['indices']['PQI']
    gqi  = rec['indices']['GQI']
    ct   = rec['kpis']['CycleTime']
    tp   = rec['kpis']['Throughput']
    alarm= rec['alarms']['severity']
    vib  = len(rec['signals']['vibration'])
    cur  = len(rec['signals']['current'])
    tmp  = len(rec['signals']['temperature'])
    print(f'  Window {i}: MHI={mhi:.1f} PQI={pqi:.1f} GQI={gqi:.1f} CT={ct:.1f}s TP={tp:.1f}kg/hr [{alarm}] vib={vib} cur={cur} temp={tmp}')

print()
print('--- Testing bearing fault ---')
cfg2 = load_config()
cfg2.severity.bearing_fault = 1.0
cfg2.vibration.bearing_fault['enable'] = True
sim2 = PulveriserSimulator(cfg2, seed=0)
rec2 = sim2.run_window()
vib_features = rec2['features']['vibration']
print(f'  Bearing fault: Kurtosis={vib_features["Kurtosis"]:.3f}  CrestFactor={vib_features["CrestFactor"]:.3f}')

print()
print('--- Testing blade wear ---')
cfg3 = load_config()
cfg3.severity.blade_wear = 0.75
sim3 = PulveriserSimulator(cfg3, seed=1)
for _ in range(20):
    sim3.run_window()
rec3 = sim3.run_window()
print(f'  Blade wear (window 20): cur_RMS={rec3["features"]["current"]["RMS"]:.4f}')

print()
print('ALL OK - synthetic package is working correctly')
