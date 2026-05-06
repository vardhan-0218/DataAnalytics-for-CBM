#!/usr/bin/env python3
"""
Verification script to confirm alert logic refactoring was successful.
This script checks that:
1. analysis.py contains the Config and AlertSystem classes
2. api_server.py imports from analysis.py (no duplication)
3. The process() method supports both return modes
"""

import sys
from pathlib import Path

def check_file_content(filepath, should_contain, should_not_contain):
    """Check if file contains/doesn't contain specific strings"""
    content = Path(filepath).read_text()
    
    results = []
    for item in should_contain:
        if item in content:
            results.append(f"✓ Found: {item}")
        else:
            results.append(f"✗ Missing: {item}")
            
    for item in should_not_contain:
        if item not in content:
            results.append(f"✓ Not found (good): {item}")
        else:
            results.append(f"✗ Still exists (bad): {item}")
            
    return results

def main():
    print("=" * 70)
    print("ALERT LOGIC REFACTORING VERIFICATION")
    print("=" * 70)
    
    # Check analysis.py
    print("\n1. Checking backend/analysis.py...")
    print("-" * 70)
    analysis_results = check_file_content(
        "backend/analysis.py",
        should_contain=[
            "class Config:",
            "class AlertSystem:",
            "def process(self, t: int, current: float, return_dict: bool = False)",
            "self.alert_states",
            "if return_dict:",
        ],
        should_not_contain=[]
    )
    for result in analysis_results:
        print(result)
    
    # Check api_server.py
    print("\n2. Checking backend/api_server.py...")
    print("-" * 70)
    api_results = check_file_content(
        "backend/api_server.py",
        should_contain=[
            "from analysis import Config as EWMAConfig, AlertSystem",
            "return_dict=True",
        ],
        should_not_contain=[
            "class EWMAConfig:",
            "class AlertSystem:",
            "def __init__(self, cfg: EWMAConfig):",  # This would be in a duplicate AlertSystem
        ]
    )
    for result in api_results:
        print(result)
    
    # Summary
    print("\n" + "=" * 70)
    all_results = analysis_results + api_results
    passed = sum(1 for r in all_results if r.startswith("✓"))
    total = len(all_results)
    
    print(f"SUMMARY: {passed}/{total} checks passed")
    
    if passed == total:
        print("✓ All checks passed! Refactoring successful.")
        print("\nNext steps:")
        print("1. Test analysis.py: python backend/analysis.py")
        print("2. Test API server: uvicorn api_server:app --reload --port 8000")
        print("3. Verify alerts trigger correctly in both modes")
        return 0
    else:
        print("✗ Some checks failed. Please review the output above.")
        return 1

if __name__ == "__main__":
    sys.exit(main())
