#include <iostream>
#include <list>
#include <unordered_map>
#include <vector>

// CS-302 Lab 4 Starter Template: LRU Page Replacement
class LRUCache {
    int capacity;
    std::list<int> pages;
    std::unordered_map<int, std::list<int>::iterator> pageMap;

public:
    explicit LRUCache(int cap) : capacity(cap) {}

    bool accessPage(int pageNumber) {
        auto it = pageMap.find(pageNumber);
        if (it != pageMap.end()) {
            // Page Hit: move to front
            pages.erase(it->second);
            pages.push_front(pageNumber);
            pageMap[pageNumber] = pages.begin();
            return true;
        }
        // Page Fault
        if (static_cast<int>(pages.size()) == capacity) {
            int lru = pages.back();
            pages.pop_back();
            pageMap.erase(lru);
        }
        pages.push_front(pageNumber);
        pageMap[pageNumber] = pages.begin();
        return false;
    }
};

int main() {
    std::vector<int> refString = {7, 0, 1, 2, 0, 3, 0, 4, 2, 3, 0, 3, 2};
    LRUCache sim(4);
    int faults = 0;
    for (int p : refString) {
        if (!sim.accessPage(p)) faults++;
    }
    std::cout << "Total Page Faults (4 frames): " << faults << std::endl;
    return 0;
}
