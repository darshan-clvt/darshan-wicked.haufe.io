Vue.component('wicked-table', {
  props: ['bundles','apimap'],
  data: function () {
      return {
          searchTerm: "",
          currentPage: 1,
          rowsPerPage: 5,
          showPopup: false,
          currentbundle: null,
          servicesInput: [],
          routesInput: [],
          selectedServices : [],
          selectedRoutes : [],
          showViewPopup: false,
          showEditPopup: false,
          popupMode: '',
          newBundleName:'',
          deletedBundles : {},
          updatedBundle : null 
      }
  },
  computed: {
      filteredBundles() {
          const searchTerm = this.searchTerm.toLowerCase();
          return this.bundles.api_bundles.filter(bundle =>
            bundle.id.toLowerCase().includes(searchTerm)
          );
        },
        paginatedBundles() {
          const startIndex = (this.currentPage - 1) * this.rowsPerPage;
          const endIndex = startIndex + this.rowsPerPage;
          return this.filteredBundles.slice(startIndex, endIndex);
        },
        totalPages() {
          return Math.ceil(this.filteredBundles.length / this.rowsPerPage);
        }
  },
  methods: {
      openPopup(bundleId,mode) {
        this.showPopup = true;
        this.currentbundle = this.bundles.api_bundles.find(
          bundle => bundle.id === bundleId
        );
        this.popupMode = mode;
      },
      closePopup() {
        this.showPopup = false;
        this.currentbundle = null;
        this.popupMode = null;
      },
      saveBundle(updatedBundle) {
        const bundleIndex = this.bundles.api_bundles.findIndex(
          (bundle) => bundle.id === updatedBundle.id
        );
        if (bundleIndex !== -1) {
          this.bundles.api_bundles[bundleIndex] = updatedBundle;
        }
        this.bundles.updatedBundle = updatedBundle
        this.bundles.deletedBundles = this.deletedBundles
        storeData()
        this.closePopup();
        this.deletedBundles = {}
      },
      deleteBundle(bundleId) {
        const bundleIndex = this.bundles.api_bundles.findIndex(
          (bundle) => bundle.id === bundleId
        );
        if (bundleIndex !== -1) {
          let deleteBundle = this.bundles.api_bundles[bundleIndex]
          let bundleId = deleteBundle.id
          this.deletedBundles[bundleId] = deleteBundle
          this.bundles.api_bundles.splice(bundleIndex, 1);
        }
      },
      goToPage(pageNumber) {
      if (pageNumber >= 1 && pageNumber <= this.totalPages) {
          this.currentPage = pageNumber;
      }
      },
      nextPage() {
      if (this.currentPage < this.totalPages) {
          this.currentPage++;
      }
      },
      previousPage() {
      if (this.currentPage > 1) {
          this.currentPage--;
      }
      },
      addBundle() {
        if(this.newBundleName) {
          let bName = this.newBundleName
          let bid = `cortellis-${bName.replace(/\s/g, "")}`
          this.bundles.api_bundles.push({
              id: bid,
              services: [],
              routes: {},
              tags: []
          })
        }
        this.newBundleName = ''
      }
  },
  template: `
  <div>
    <h1>Bundles</h1>
    <input type="text" v-model="searchTerm" placeholder="Search by name">
    <input type="text" v-model="newBundleName" placeholder="Add new Bundle">
    <button @click="addBundle">ADD Bundle</button>
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="bundle in paginatedBundles" :key="bundle.id">
          <td>{{ bundle.id }}</td>
          <td>
            <button @click="openPopup(bundle.id, 'edit')">View/Edit</button>
            <button @click="deleteBundle(bundle.id)">Delete</button>
          </td>
        </tr>
      </tbody>
    </table>

    
    <div class="pagination">
      <button @click="previousPage" :disabled="currentPage === 1">Previous</button>
      <span>Page {{ currentPage }} of {{ totalPages }}</span>
      <button @click="nextPage" :disabled="currentPage === totalPages">Next</button>
      <div class="page-selector">
        <span>Go to page:</span>
        <input type="number" v-model.number="currentPage" min="1" :max="totalPages">
        <button @click="goToPage(currentPage)">Go</button>
        <button @click="saveBundle" class="save-button">Save</button>
      </div>
    </div>
    <popup
      v-if="showPopup"
      :bundle="currentbundle"
      :mode="popupMode"
      :servicesList="apimap"
      @save="saveBundle"
      @close="closePopup"
    ></popup>
  </div>
  `
});
// ==============================================================

Vue.component('popup', {
  props : ['bundle','mode','servicesList'],
  data: function() {
      return {
      selectedServices: [],
      selectedPaths: {},
      searchQuery: '',
      currentPage: 1,
      pageSize: 5,
      rowsPerPage: 5
  }
},
mounted() {
  this.selectedServices = [...this.bundle.services];
  for (const service of this.bundle.services) {
    this.selectedPaths[service] = [...this.bundle.routes[service]];
  }
},
computed: {
  filteredServices() {
    if (!this.searchQuery) {
      return Object.keys(this.servicesList);
    }
    return Object.keys(this.servicesList).filter(serviceName =>
      serviceName.toLowerCase().includes(this.searchQuery.toLowerCase())
    );
  },
  paginatedServices() {
    const startIndex = (this.currentPage - 1) * this.pageSize;
    const endIndex = startIndex + this.pageSize;
    return this.filteredServices.slice(startIndex, endIndex);
  },
  totalPages() {
    return Math.ceil(this.filteredServices.length / this.rowsPerPage);
  }
},
methods: {
  isServiceChecked(serviceName) {
    return this.selectedServices.includes(serviceName);
  },
  isPathChecked(serviceName, path) {
    return this.selectedPaths[serviceName]?.includes(path);
  },
  toggleService(serviceName, event) {
    const index = this.selectedServices.indexOf(serviceName);
    if(event.target.checked) {
      if(index == -1) {
        this.selectedServices.push(serviceName);
        this.selectedPaths[serviceName] = [...this.servicesList[serviceName]];
      }
    } else {
      if(index != -1) {
      this.selectedServices.splice(index, 1);
      delete this.selectedPaths[serviceName];
    }
  }
  },
  togglePath(serviceName, path , event) {
    if(event.target.checked) {
      const serviceIdx = this.selectedServices.indexOf(serviceName);
      if (serviceIdx === -1) {
        this.selectedServices.push(serviceName);
      }
      if (!this.selectedPaths[serviceName]) {
        this.selectedPaths[serviceName] = [];
      }
      const index = this.selectedPaths[serviceName].indexOf(path);
      if (index === -1) {
        this.selectedPaths[serviceName].push(path);
      }
    } else {
        const index = this.selectedPaths[serviceName].indexOf(path);
        this.selectedPaths[serviceName].splice(index, 1);
        if(!this.selectedPaths[serviceName].length > 0) {
          const serviceIdx = this.selectedServices.indexOf(serviceName);
          this.selectedServices.splice(serviceIdx, 1);
        }
      }
  },saveBundle() {
    const updatedBundle = {
      id : this.bundle.id,
      name : this.bundle.name,
      services: [...this.selectedServices],
      routes: { ...this.selectedPaths }
    };
    this.$emit('save', updatedBundle);
  },
  closePopup() {
    this.$emit('close');
  },
  goToPage(pageNumber) {
    if (pageNumber >= 1 && pageNumber <= this.totalPages) {
        this.currentPage = pageNumber;
    }
  }
},
template : 
`<div class="popup" ref="bundlePopup">
  <span class="close" @click="closePopup">&times;</span>
  <h2>{{ bundle.name }}</h2>
  <input type="text" v-model="searchQuery" placeholder="Search services" />
  <table>
      <thead>
        <tr>
          <th>Select All</th>
          <th>Service Name</th>
          <th>Routes</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(serviceName,idx) in paginatedServices" :key="serviceName">
          <td><label>
          <input
            type="checkbox"
            :id="serviceName"
            :checked="isServiceChecked(serviceName)"
            @change="toggleService(serviceName, $event)"
          />
        </label>
        </td>
        <td>{{ serviceName }}</td>
        <td><ul class="hide-dot">
          <li v-for="path in servicesList[serviceName]" :key="path">
            <label>
              <input
                type="checkbox"
                :id="path"
                :checked="isPathChecked(serviceName, path)"
                @change="togglePath(serviceName, path, $event)"
              />
              {{ path }}
            </label>
          </li>
        </ul>
        </td>
        </tr>
      </tbody>
  </table>
  <div class="pagination">
    <button :disabled="currentPage === 1" @click="currentPage--">Previous</button>
    <span>Page {{ currentPage }} of {{ totalPages }}</span>
    <button :disabled="currentPage === Math.ceil(filteredServices.length / pageSize)" @click="currentPage++">Next</button>
    <div class="page-selector">
    <span>Go to page:</span>
    <input type="number" v-model.number="currentPage" min="1" :max="totalPages">
    <button @click="goToPage(currentPage)">Go</button>
  </div>
  </div>

  <button @click="saveBundle" class="save-button">Save</button>
</div>`
})

const vm = new Vue({
  el: '#vueBase',
  data: injectedData
  
});


function storeData() {
  let data = vm.$data
  delete data.apiMap
  $.post({
      url: `/bundles/save`,
      data: JSON.stringify(data),
      contentType: 'application/json'
  }).fail(function () {
      alert('Could not store data, an error occurred.');
  }).done(function () {
      alert('Successfully stored data.');
  });
}